import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dateString, logSetArgsSchema } from "@trainheroic-unofficial/dto";
import {
  addExercisesToWorkout,
  coerceInt,
  createPersonalWorkout,
  exerciseUnits,
  fetchAthletePrefs,
  fetchAthleteProfileSummary,
  fetchAthleteUser,
  fetchAthleteWorkouts,
  fetchExerciseHistoryDetail,
  fetchExerciseHistoryList,
  fetchExerciseStats,
  fetchLeaderboard,
  fetchPersonalRecords,
  fetchWorkingMaxes,
  isRecord,
  logAthleteSet,
  presentAthleteWorkouts,
  presentExerciseHistory,
  searchExerciseHistory,
} from "@trainheroic-unofficial/js";
import type { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { confirmGate, NOT_CONFIRMED } from "../confirm";
import { attempt, DESTRUCTIVE, errorResult, idParam, jsonResult, READ, toId } from "../context";

/**
 * Athlete tools need only the client (no exercise-library index), so they take a narrower
 * context than the coach tools. A full `ToolContext` also satisfies this, so the same ctx
 * object can be passed.
 */
export type AthleteContext = { client: TrainHeroicClient };

/** Returns (and memoizes) the logged-in account's `/user/simple` payload. */
type Whoami = () => Promise<Record<string, unknown>>;
/** Resolves (and memoizes) the logged-in athlete's numeric user id. */
type UserId = () => Promise<number>;

/** Identity, profile, prefs, working maxes, leaderboard. */
function registerProfileTools(
  server: McpServer,
  ctx: AthleteContext,
  whoami: Whoami,
  userId: UserId,
): void {
  server.registerTool(
    "athlete_whoami",
    {
      title: "Who am I (athlete)",
      description: "The logged-in account's identity (id, name, roles) from /user/simple.",
      inputSchema: {},
      annotations: READ,
    },
    () => attempt(async () => jsonResult(await whoami())),
  );

  server.registerTool(
    "athlete_profile",
    {
      title: "Athlete profile + lifetime totals",
      description:
        "Lifetime training totals (reps, volume, sessions, first/last logged) plus the profile " +
        "(name, units, dob). Set useMetric for kg/metric totals.",
      inputSchema: { useMetric: z.boolean().optional() },
      annotations: READ,
    },
    ({ useMetric }) =>
      attempt(async () => {
        const id = await userId();
        const [summary, user] = await Promise.all([
          fetchAthleteProfileSummary(ctx.client, id, useMetric ?? false),
          fetchAthleteUser(ctx.client, id),
        ]);
        return jsonResult({ summary, user });
      }),
  );

  server.registerTool(
    "athlete_prefs",
    {
      title: "Athlete preferences",
      description: "Notification and display preference flags for the athlete account.",
      inputSchema: {},
      annotations: READ,
    },
    () => attempt(async () => jsonResult(await fetchAthletePrefs(ctx.client))),
  );

  server.registerTool(
    "athlete_working_maxes",
    {
      title: "Working maxes",
      description: "The athlete's working max per exercise (drives % prescriptions).",
      inputSchema: {},
      annotations: READ,
    },
    () => attempt(async () => jsonResult(await fetchWorkingMaxes(ctx.client))),
  );

  server.registerTool(
    "athlete_leaderboard",
    {
      title: "Benchmark leaderboard",
      description: "Leaderboard for a benchmark/test workout by its workout id.",
      inputSchema: {
        workoutId: idParam,
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().positive().max(200).optional(),
        gender: z.number().int().optional(),
      },
      annotations: READ,
    },
    ({ workoutId, page, pageSize, gender }) =>
      attempt(async () => {
        const opts: { page?: number; pageSize?: number; gender?: number } = {};
        if (page !== undefined) opts.page = page;
        if (pageSize !== undefined) opts.pageSize = pageSize;
        if (gender !== undefined) opts.gender = gender;
        return jsonResult(await fetchLeaderboard(ctx.client, toId(workoutId), opts));
      }),
  );
}

/** Workouts, exercise catalog, per-exercise history/PRs/stats. */
function registerExerciseTools(server: McpServer, ctx: AthleteContext, userId: UserId): void {
  server.registerTool(
    "athlete_workouts",
    {
      title: "Workouts in a date range",
      description:
        "Scheduled + completed workouts in an inclusive YYYY-MM-DD window, flattened to " +
        "blocks/exercises with per-set prescriptions and positional units. Set raw:true for the " +
        "untouched API objects. Narrow the window if the result is truncated.",
      inputSchema: { startDate: dateString, endDate: dateString, raw: z.boolean().optional() },
      annotations: READ,
    },
    ({ startDate, endDate, raw }) =>
      attempt(async () => {
        const workouts = await fetchAthleteWorkouts(ctx.client, startDate, endDate);
        const data = raw === true ? workouts : presentAthleteWorkouts(workouts);
        return jsonResult(data, { hint: "Narrow startDate/endDate to shrink this result." });
      }),
  );

  server.registerTool(
    "athlete_exercises",
    {
      title: "Search logged exercises",
      description:
        "The exercises the athlete has logged (id + title + positional units). Pass q to " +
        "free-text search by name; use the returned id with athlete_exercise_history / _stats.",
      inputSchema: {
        q: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
      annotations: READ,
    },
    ({ q, limit }) =>
      attempt(async () => {
        const rows =
          q !== undefined && q.trim() !== ""
            ? await searchExerciseHistory(ctx.client, q, limit ?? 20)
            : await fetchExerciseHistoryList(ctx.client);
        const items = rows.map((r) => ({
          id: r.id,
          title: r.title,
          isCircuit: r.isCircuit ?? false,
          units: exerciseUnits(r.param1Type, r.param2Type),
        }));
        return jsonResult(items, { hint: "Pass q to search by name, or limit to cap the list." });
      }),
  );

  server.registerTool(
    "athlete_exercise_history",
    {
      title: "Exercise history + PRs",
      description:
        "Per-exercise PRs and the dated session time-series (sets performed, estimated 1RM). " +
        "Set raw:true for the untouched API object. Get the exercise id from athlete_exercises.",
      inputSchema: { exerciseId: idParam, raw: z.boolean().optional() },
      annotations: READ,
    },
    ({ exerciseId, raw }) =>
      attempt(async () => {
        const detail = await fetchExerciseHistoryDetail(
          ctx.client,
          toId(exerciseId),
          await userId(),
        );
        return jsonResult(raw === true ? detail : presentExerciseHistory(detail));
      }),
  );

  server.registerTool(
    "athlete_personal_records",
    {
      title: "Exercise personal records",
      description: "Personal records for an exercise (reps/weight, strength-standard filters).",
      inputSchema: { exerciseId: idParam },
      annotations: READ,
    },
    ({ exerciseId }) =>
      attempt(async () => jsonResult(await fetchPersonalRecords(ctx.client, toId(exerciseId)))),
  );

  server.registerTool(
    "athlete_exercise_stats",
    {
      title: "Exercise stats (last performance + PR)",
      description:
        "Last performance and PR for an exercise as of a date (YYYY-MM-DD, required by the API).",
      inputSchema: { exerciseId: idParam, date: dateString },
      annotations: READ,
    },
    ({ exerciseId, date }) =>
      attempt(async () =>
        jsonResult(await fetchExerciseStats(ctx.client, toId(exerciseId), await userId(), date)),
      ),
  );
}

/** Create a personal workout session and add exercises to it. */
function registerSessionTools(server: McpServer, ctx: AthleteContext): void {
  server.registerTool(
    "athlete_session_create",
    {
      title: "Create personal workout session",
      description:
        "Create a new personal workout session for a given YYYY-MM-DD date on the athlete's " +
        "personal calendar. Returns programWorkoutId, workoutId (pass to " +
        "athlete_session_add_exercises), savedWorkoutId, groupId, and date.",
      inputSchema: { date: dateString },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ date }) => attempt(async () => jsonResult(await createPersonalWorkout(ctx.client, date))),
  );

  server.registerTool(
    "athlete_session_add_exercises",
    {
      title: "Add exercises to a personal workout session",
      description:
        "Add one or more exercises to a personal workout session. Get workoutId from " +
        "athlete_session_create. Each item needs an exerciseId (from athlete_exercises) and a " +
        "1-based order. Returns saved workout set objects: each top-level id is a " +
        "savedWorkoutSetId and savedWorkoutSetExercises[].id is a savedWorkoutSetExerciseId " +
        "— both needed for athlete_log_set.",
      inputSchema: {
        workoutId: idParam,
        exercises: z
          .array(z.object({ exerciseId: idParam, order: z.number().int().positive() }))
          .min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ workoutId, exercises }) =>
      attempt(async () => {
        const mapped = exercises.map((e) => ({ exerciseId: toId(e.exerciseId), order: e.order }));
        return jsonResult(await addExercisesToWorkout(ctx.client, toId(workoutId), mapped), {
          hint: "Each top-level id is a savedWorkoutSetId; savedWorkoutSetExercises[].id is the savedWorkoutSetExerciseId for athlete_log_set.",
        });
      }),
  );
}

/** The gated set-logging write. */
function registerLogTool(server: McpServer, ctx: AthleteContext): void {
  server.registerTool(
    "athlete_log_set",
    {
      title: "Log completed set results",
      description:
        "Athlete-facing write: record entered results (reps/weight per set) for a saved workout " +
        "set on a given day, marking the set completed. Writes to the athlete's (coach-visible) " +
        "training log and shows in exercise history. Get savedWorkoutSetId + " +
        "savedWorkoutSetExerciseId from athlete_workouts (raw:true). Requires confirmation " +
        "(elicitation or confirm:true).",
      inputSchema: { ...logSetArgsSchema.shape, confirm: z.boolean().optional() },
      annotations: DESTRUCTIVE,
    },
    ({ date, savedWorkoutSetId, results, confirm }, extra) =>
      attempt(async () => {
        const ok = await confirmGate(
          server,
          extra.requestId,
          `Log results to saved workout set ${toId(savedWorkoutSetId)} on ${date}? This writes to your coach-visible training log.`,
          confirm,
        );
        if (!ok) return errorResult(NOT_CONFIRMED);
        const mapped = results.map((r) => ({
          savedWorkoutSetExerciseId: toId(r.savedWorkoutSetExerciseId),
          sets: r.sets.map((s) => {
            const slot: { param1?: number | string; param2?: number | string } = {};
            if (s.param1 !== undefined) slot.param1 = s.param1;
            if (s.param2 !== undefined) slot.param2 = s.param2;
            return slot;
          }),
        }));
        return jsonResult(
          await logAthleteSet(ctx.client, {
            date,
            savedWorkoutSetId: toId(savedWorkoutSetId),
            results: mapped,
          }),
        );
      }),
  );
}

/**
 * Live tools over the logged-in user's own training (history, scheduled/completed workouts,
 * PRs, working maxes), plus a gated set-logging write. The athlete user id is
 * resolved once from /user/simple and reused across tools.
 */
export function registerAthleteTrainingTools(server: McpServer, ctx: AthleteContext): void {
  // One cached /user/simple round-trip feeds both athlete_whoami and the id-dependent tools.
  let whoamiCache: Record<string, unknown> | null = null;
  const whoami: Whoami = async () => {
    if (whoamiCache === null) {
      const res = await ctx.client.request<Record<string, unknown>>("GET", "/user/simple");
      if (!res.ok || !isRecord(res.data)) throw new Error("Could not load /user/simple.");
      whoamiCache = res.data;
    }
    return whoamiCache;
  };
  const userId: UserId = async () => {
    const id = coerceInt((await whoami()).id);
    if (id === null || id <= 0) {
      throw new Error("Could not resolve athlete user id from /user/simple.");
    }
    return id;
  };

  registerProfileTools(server, ctx, whoami, userId);
  registerExerciseTools(server, ctx, userId);
  registerSessionTools(server, ctx);
  registerLogTool(server, ctx);
}
