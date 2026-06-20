import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ExerciseIndex } from "@trainheroic-unofficial/js";
import { type BlockSpec, unitAdvisory } from "@trainheroic-unofficial/js";
import {
  buildSession,
  type BuildOptions,
  publishSession,
  readSession,
  removeSession,
  type WorkoutDate,
} from "@trainheroic-unofficial/js";
import { confirmGate, NOT_CONFIRMED } from "../confirm";
import { attempt, errorResult, jsonResult } from "../context";
import type { ToolContext } from "../context";

const exerciseSpec = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().optional(),
  reps: z.union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))]).optional(),
  sets: z.number().optional(),
  weight: z.union([z.number(), z.array(z.number())]).optional(),
  rpe: z.union([z.number(), z.string()]).optional(),
  instr: z.string().optional(),
  param_1_type: z.number().optional(),
  param_2_type: z.number().optional(),
});

const leaderboardSpec = z.union([
  z.string(),
  z.number(),
  z.object({
    unit: z.union([z.string(), z.number()]).optional(),
    type: z.union([z.string(), z.number()]).optional(),
    lowest_wins: z.boolean().optional(),
    instruction: z.string().optional(),
  }),
]);

const blockSpec = z.object({
  title: z.string(),
  type: z.number().optional(),
  instruction: z.string().optional(),
  leaderboard: leaderboardSpec.optional(),
  exercises: z.array(exerciseSpec),
});

function parseDate(s: string): WorkoutDate {
  const parts = s.split("-").map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid date '${s}'; expected YYYY-M-D.`);
  }
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0] as const;
}

async function collectAdvisories(
  blocks: BlockSpec[],
  index: ExerciseIndex,
): Promise<{ notes: string[]; warnings: string[] }> {
  const pairs = blocks.flatMap((b) => b.exercises.map((ex) => ({ block: b, ex })));
  const defaults = await Promise.all(
    pairs.map((p) => {
      const id = Number(p.ex.id);
      return Number.isFinite(id) ? index.defaults(id) : Promise.resolve(null);
    }),
  );
  const notes: string[] = [];
  const warnings: string[] = [];
  pairs.forEach((p, i) => {
    const def = defaults[i];
    if (!def) return;
    const advisory = unitAdvisory(p.block.title, p.ex, def);
    notes.push(...advisory.notes);
    warnings.push(...advisory.warnings);
  });
  return { notes, warnings };
}

/** Workout building, read-back, publishing, and removal. */
export function registerWorkoutTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "workout_build",
    {
      title: "Build a workout session (draft)",
      description:
        "Build an UNPUBLISHED session from a spec (program -> session -> blocks -> exercises). " +
        "Two exercises in one block become a superset. Add a block 'leaderboard' for a Red-Zone " +
        "score. Returns the draft ids, a read-back, and unit advisories. Review, then workout_publish.",
      inputSchema: {
        programId: z.number(),
        date: z.string().optional(),
        timelineDay: z.number().optional(),
        blocks: z.array(blockSpec),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ programId, date, timelineDay, blocks }) =>
      attempt(async () => {
        if (date === undefined && timelineDay === undefined) {
          return errorResult("Provide either date (YYYY-M-D) or timelineDay.");
        }
        const typed = blocks as BlockSpec[];
        const opts: BuildOptions = { programId, blocks: typed, publish: false };
        if (date !== undefined) opts.date = parseDate(date);
        if (timelineDay !== undefined) opts.timelineDay = timelineDay;

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
        jsonResult(await readSession(ctx.client, programId, parseDate(date), pwId)),
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
          readback: await readSession(ctx.client, programId, parseDate(date), pwId),
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
