import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type BlockSpec, blockSpecSchema, parseWorkoutDate } from "@trainheroic-unofficial/dto";
import {
  buildSession,
  type BuildOptions,
  collectAdvisories,
  copySession,
  publishSession,
  readSession,
  removeSession,
} from "@trainheroic-unofficial/js";
import { confirmGate, NOT_CONFIRMED } from "../confirm";
import { apiCall, attempt, errorResult, jsonResult } from "../context";
import type { ToolContext } from "../context";

/** Build a draft, read it back, and publish it. */
function registerBuild(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "workout_build",
    {
      title: "Build a workout session (draft)",
      description:
        "Build an UNPUBLISHED session from a spec (program -> session -> blocks -> exercises). " +
        "Two exercises in one block become a superset. Add a block 'leaderboard' for a Red-Zone " +
        "score, or a top-level 'instruction' for the session note (Coach Instructions). Returns " +
        "the draft ids, a read-back, and unit advisories. Review, then workout_publish.",
      inputSchema: {
        programId: z.number(),
        date: z.string().optional(),
        timelineDay: z.number().optional(),
        blocks: z.array(blockSpecSchema),
        instruction: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ programId, date, timelineDay, blocks, instruction }) =>
      attempt(async () => {
        if (date === undefined && timelineDay === undefined) {
          return errorResult("Provide either date (YYYY-M-D) or timelineDay.");
        }
        const typed = blocks as BlockSpec[];
        const opts: BuildOptions = { programId, blocks: typed, publish: false };
        if (date !== undefined) opts.date = parseWorkoutDate(date);
        if (timelineDay !== undefined) opts.timelineDay = timelineDay;
        if (instruction !== undefined) opts.instruction = instruction;

        const advisories = await collectAdvisories(typed, ctx.index);
        const built = await buildSession(ctx.client, opts);
        const readback = opts.date
          ? await readSession(ctx.client, programId, opts.date, built.pwId)
          : null;
        return jsonResult({
          ...built,
          published: false,
          advisories,
          readback,
          note: "Draft created (unpublished). Review, then call workout_publish to make it athlete-facing.",
        });
      }),
  );

  server.registerTool(
    "workout_read",
    {
      title: "Read a built session",
      description: "Read-back a session by programId, date (YYYY-M-D), and programWorkout id.",
      inputSchema: { programId: z.number(), date: z.string(), pwId: z.number() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ programId, date, pwId }) =>
      attempt(async () =>
        jsonResult(await readSession(ctx.client, programId, parseWorkoutDate(date), pwId)),
      ),
  );

  server.registerTool(
    "workout_publish",
    {
      title: "Publish a session",
      description:
        "Publish a built session — ATHLETE-FACING and immediate. Requires confirmation " +
        "(elicitation, or confirm:true).",
      inputSchema: {
        programId: z.number(),
        date: z.string(),
        pwId: z.number(),
        confirm: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    ({ programId, date, pwId, confirm }, extra) =>
      attempt(async () => {
        const ok = await confirmGate(
          server,
          extra.requestId,
          `Publish session ${pwId} on ${date}? This is athlete-facing and immediate.`,
          confirm,
        );
        if (!ok) return errorResult(NOT_CONFIRMED);
        await publishSession(ctx.client, pwId);
        return jsonResult({
          published: pwId,
          readback: await readSession(ctx.client, programId, parseWorkoutDate(date), pwId),
        });
      }),
  );
}

/** Calendar lifecycle for an existing session: remove, unpublish, copy, save to library. */
function registerLifecycle(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "session_remove",
    {
      title: "Remove a session",
      description:
        "Delete a session from the live calendar (also the way to replace a date: remove then " +
        "build). Hard to undo. Requires confirmation (elicitation, or confirm:true).",
      inputSchema: { programId: z.number(), pwId: z.number(), confirm: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    ({ programId, pwId, confirm }, extra) =>
      attempt(async () => {
        const ok = await confirmGate(
          server,
          extra.requestId,
          `Delete session ${pwId}? This removes it from the live calendar and is hard to undo.`,
          confirm,
        );
        if (!ok) return errorResult(NOT_CONFIRMED);
        await removeSession(ctx.client, programId, pwId);
        return jsonResult({ removed: pwId });
      }),
  );

  server.registerTool(
    "session_unpublish",
    {
      title: "Unpublish a session",
      description:
        "Unpublish a previously published session (POST .../programWorkout/unPublish/{pwId}). It " +
        "is no longer athlete-facing. Requires confirmation (elicitation, or confirm:true).",
      inputSchema: { pwId: z.number(), confirm: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    ({ pwId, confirm }, extra) =>
      attempt(async () => {
        const ok = await confirmGate(
          server,
          extra.requestId,
          `Unpublish session ${pwId}? Athletes will no longer see it.`,
          confirm,
        );
        if (!ok) return errorResult(NOT_CONFIRMED);
        return apiCall(ctx, "POST", `/2.0/coach/calendar/programWorkout/unPublish/${pwId}`);
      }),
  );

  server.registerTool(
    "session_copy",
    {
      title: "Copy a session to a date",
      description:
        "Copy/repeat a session to a target date on a program (POST .../copyProgramWorkout). " +
        "toDate is YYYY-M-D. Creates a new session; review and publish it separately.",
      inputSchema: { toProgramId: z.number(), pwId: z.number(), toDate: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ toProgramId, pwId, toDate }) =>
      attempt(async () => jsonResult(await copySession(ctx.client, { toProgramId, pwId, toDate }))),
  );

  server.registerTool(
    "session_save_as_template",
    {
      title: "Save a session to the library",
      description:
        "Save an existing session as a reusable template in the session library " +
        "(POST .../programWorkout/saveWorkoutAsTemplate/{workoutId}). Pass the workout_id.",
      inputSchema: { workoutId: z.number() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ workoutId }) =>
      apiCall(ctx, "POST", `/2.0/coach/calendar/programWorkout/saveWorkoutAsTemplate/${workoutId}`),
  );
}

/** Workout building, read-back, publishing, and the session calendar lifecycle. */
export function registerWorkoutTools(server: McpServer, ctx: ToolContext): void {
  registerBuild(server, ctx);
  registerLifecycle(server, ctx);
}
