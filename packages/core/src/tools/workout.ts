import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type BlockSpec, blockSpecSchema, parseWorkoutDate } from "@trainheroic-unofficial/dto";
import {
  buildSession,
  type BuildOptions,
  collectAdvisories,
  publishSession,
  readSession,
  removeSession,
} from "@trainheroic-unofficial/js";
import { confirmGate, NOT_CONFIRMED } from "../confirm";
import { attempt, errorResult, jsonResult } from "../context";
import type { ToolContext } from "../context";

/** Workout building, read-back, publishing, and removal. */
export function registerWorkoutTools(server: McpServer, ctx: ToolContext): void {
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
}
