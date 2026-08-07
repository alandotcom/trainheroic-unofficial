import type { McpServer } from "@modelcontextprotocol/server";
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
  resolveBuildProgramId,
} from "@trainheroic-unofficial/js";
import { confirmGate } from "../confirm";
import { apiCall, attempt, errorResult, idParam, jsonResult, toId } from "../context";
import type { ToolContext } from "../context";

/** Build a draft session (workout_build). */
function registerBuild(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "workout_build",
    {
      title: "Build a workout session (draft)",
      description:
        "Build an UNPUBLISHED session from a spec (program -> session -> blocks -> exercises). " +
        "Pass programId for a team/group calendar (list_teams → group_program), or athleteId " +
        "to write on that roster athlete's coach calendar (resolved via " +
        "/v5/calendars/athletes/{id} — the same calendar the coach web app opens from My " +
        "Athletes). athleteId requires date. Two exercises in one block become a " +
        "superset. A block with empty exercises and a non-empty block instruction is a text-only " +
        "Circuit / Conditioning block (type 1). Add a block 'leaderboard' for a Red-Zone score, " +
        "or a top-level 'instruction' for the session note (Coach Instructions). Returns the " +
        "draft ids, a read-back, and unit advisories. Review, then workout_publish.",
      inputSchema: {
        programId: z.number().optional(),
        athleteId: idParam.optional(),
        date: z.string().optional(),
        timelineDay: z.number().optional(),
        blocks: z.array(blockSpecSchema),
        instruction: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ programId, athleteId, date, timelineDay, blocks, instruction }) =>
      attempt(async () => {
        if (date === undefined && timelineDay === undefined) {
          return errorResult("Provide either date (YYYY-M-D) or timelineDay.");
        }
        const resolveArgs: {
          programId?: number;
          athleteId?: number;
          date?: string;
        } = {};
        if (programId !== undefined) resolveArgs.programId = programId;
        if (athleteId !== undefined) resolveArgs.athleteId = toId(athleteId);
        if (date !== undefined) resolveArgs.date = date;
        const resolved = await resolveBuildProgramId(ctx.client, resolveArgs);

        const typed = blocks as BlockSpec[];
        const opts: BuildOptions = { programId: resolved, blocks: typed, publish: false };
        if (date !== undefined) opts.date = parseWorkoutDate(date);
        if (timelineDay !== undefined) opts.timelineDay = timelineDay;
        if (instruction !== undefined) opts.instruction = instruction;

        const advisories = await collectAdvisories(typed, ctx.index);
        const built = await buildSession(ctx.client, opts);
        const readback = opts.date
          ? await readSession(ctx.client, resolved, opts.date, built.pwId)
          : null;
        return jsonResult({
          ...built,
          programId: resolved,
          published: false,
          advisories,
          readback,
          note: "Draft created (unpublished). Review, then call workout_publish to make it athlete-facing.",
        });
      }),
  );
}

/** Read-back and publish for a built session. */
function registerReadPublish(server: McpServer, ctx: ToolContext): void {
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
        const blocked = confirmGate(
          extra,
          `Publish session ${pwId} on ${date}? This is athlete-facing and immediate.`,
          confirm,
        );
        if (blocked) return blocked;
        await publishSession(ctx.client, pwId);
        return jsonResult({
          published: pwId,
          readback: await readSession(ctx.client, programId, parseWorkoutDate(date), pwId),
          note:
            "Published. Verify with workout_read (same programId/date/pwId). Do not use " +
            "athlete_workouts to check a coach-published team session — that tool is the " +
            "authenticated user's own athlete calendar, not a roster athlete's schedule. For a " +
            "roster athlete's view use athlete_saved_workouts.",
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
      inputSchema: {
        programId: z.number(),
        pwId: z.number(),
        confirm: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    ({ programId, pwId, confirm }, extra) =>
      attempt(async () => {
        const blocked = confirmGate(
          extra,
          `Delete session ${pwId}? This removes it from the live calendar and is hard to undo.`,
          confirm,
        );
        if (blocked) return blocked;
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
        const blocked = confirmGate(
          extra,
          `Unpublish session ${pwId}? Athletes will no longer see it.`,
          confirm,
        );
        if (blocked) return blocked;
        return apiCall(ctx, "POST", `/2.0/coach/calendar/programWorkout/unPublish/${pwId}`);
      }),
  );

  server.registerTool(
    "session_copy",
    {
      title: "Copy a session to a date",
      description:
        "Copy/repeat a session to a target date on a program (POST .../copyProgramWorkout). " +
        "toDate is YYYY-M-D. Creates a new session; review and publish it separately. " +
        "toProgramId may be a team group_program or an athlete calendar program id " +
        "(from /v5/calendars/athletes/{athleteId}?year=&month= / workout_build athleteId).",
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
  registerReadPublish(server, ctx);
  registerLifecycle(server, ctx);
}
