// The athlete-facing SDK surface. These functions reach the same TrainHeroic hosts as the
// coach SDK (default `coach` base) but read the logged-in user's own training: scheduled and
// completed workouts, per-exercise history, PRs, and working maxes. Runtime-agnostic: no
// `node:*`, so this runs unchanged on workerd.

import { coerceInt, exerciseUnits, isRecord, rankSearch } from "./exercise-util";
import type { TrainHeroicClient } from "./client";
import type {
  AthleteProfileSummary,
  AthletePrefs,
  AthleteUser,
  AthleteWorkingMax,
  AthleteWorkoutBlock,
  AthleteWorkoutExercise,
  AthleteWorkoutView,
  ExerciseHistoryDetail,
  ExerciseHistoryListItem,
  ExerciseStats,
  PersonalRecord,
  PresentedExerciseHistory,
  ProgramWorkout,
} from "@trainheroic-unofficial/dto";

async function getJson<T>(client: TrainHeroicClient, path: string, label: string): Promise<T> {
  const res = await client.request<T>("GET", path);
  if (!res.ok) throw new Error(`${label} failed (HTTP ${res.status}).`);
  return res.data;
}

async function getArray<T>(client: TrainHeroicClient, path: string, label: string): Promise<T[]> {
  const res = await client.request<unknown>("GET", path);
  if (!res.ok || !Array.isArray(res.data)) throw new Error(`${label} failed (HTTP ${res.status}).`);
  return res.data as T[];
}

/**
 * The logged-in account's numeric user id (the athlete warehouse's tenant key, and a required
 * query arg for several athlete endpoints). Works from any session — coach or athlete — and
 * even from a cached session that never went through login.
 */
export async function resolveAthleteUserId(client: TrainHeroicClient): Promise<number> {
  const res = await client.request<Record<string, unknown>>("GET", "/user/simple");
  const id = isRecord(res.data) ? coerceInt(res.data.id) : null;
  // Guard the tenant key at the source (mirrors resolveOrgId): a non-positive id must never
  // become a real-looking query arg or a poisoned warehouse partition key. A thrown result is
  // not cached, so a transient failure is retried on the next call.
  if (!res.ok || id === null || id <= 0) {
    throw new Error("Could not resolve athlete user id from /user/simple.");
  }
  return id;
}

/** Lifetime training totals. `use_metric` is required by the API (omitting it 400s). */
export function fetchAthleteProfileSummary(
  client: TrainHeroicClient,
  userId: number,
  useMetric = false,
): Promise<AthleteProfileSummary> {
  const metric = useMetric ? 1 : 0;
  return getJson(
    client,
    `/v5/athleteProfile/summary?user_id=${userId}&use_metric=${metric}`,
    "athlete profile summary",
  );
}

export function fetchAthleteUser(client: TrainHeroicClient, userId: number): Promise<AthleteUser> {
  return getJson(client, `/v5/users/${userId}`, "athlete user");
}

export function fetchAthletePrefs(client: TrainHeroicClient): Promise<AthletePrefs> {
  return getJson(client, "/1.0/athlete/prefs", "athlete prefs");
}

export function fetchWorkingMaxes(client: TrainHeroicClient): Promise<AthleteWorkingMax[]> {
  return getArray(client, "/2.0/athlete/workingMax", "athlete working maxes");
}

export function fetchExerciseHistoryList(
  client: TrainHeroicClient,
): Promise<ExerciseHistoryListItem[]> {
  return getArray(client, "/v5/users/exercises/history", "athlete exercise history list");
}

/** Free-text search over the athlete's logged exercises (FTS replacement via rankSearch). */
export async function searchExerciseHistory(
  client: TrainHeroicClient,
  query: string,
  limit = 20,
): Promise<ExerciseHistoryListItem[]> {
  const rows = await fetchExerciseHistoryList(client);
  // rankSearch treats a missing can_edit as the standard (non-custom) case, so athlete rows
  // (which have no can_edit) rank directly.
  return rankSearch(rows, query, limit);
}

export function fetchExerciseHistoryDetail(
  client: TrainHeroicClient,
  exerciseId: number,
  userId: number,
): Promise<ExerciseHistoryDetail> {
  return getJson(
    client,
    `/v5/exercises/${exerciseId}/history?userId=${userId}`,
    "athlete exercise history",
  );
}

export function fetchPersonalRecords(
  client: TrainHeroicClient,
  exerciseId: number,
): Promise<PersonalRecord[]> {
  return getArray(
    client,
    `/v5/exercises/${exerciseId}/personalRecords`,
    "athlete personal records",
  );
}

/** Last performance + PR for an exercise. `date` (YYYY-MM-DD) is required by the API. */
export function fetchExerciseStats(
  client: TrainHeroicClient,
  exerciseId: number,
  userId: number,
  date: string,
): Promise<ExerciseStats> {
  return getJson(
    client,
    `/v5/exercises/${exerciseId}/stats?userId=${userId}&date=${date}`,
    "athlete exercise stats",
  );
}

/** Scheduled + completed workouts in an inclusive YYYY-MM-DD window. */
export function fetchAthleteWorkouts(
  client: TrainHeroicClient,
  startDate: string,
  endDate: string,
): Promise<ProgramWorkout[]> {
  return getArray(
    client,
    `/3.0/athlete/programworkout/range?startDate=${startDate}&endDate=${endDate}`,
    "athlete workouts",
  );
}

export function fetchLeaderboard(
  client: TrainHeroicClient,
  workoutId: number,
  opts: { page?: number; pageSize?: number; gender?: number } = {},
): Promise<unknown> {
  const qs = new URLSearchParams();
  if (opts.page !== undefined) qs.set("page", String(opts.page));
  if (opts.pageSize !== undefined) qs.set("pageSize", String(opts.pageSize));
  if (opts.gender !== undefined) qs.set("gender", String(opts.gender));
  const query = qs.toString();
  return getJson(
    client,
    `/3.0/athlete/leaderboard/${workoutId}${query ? `?${query}` : ""}`,
    "athlete leaderboard",
  );
}

// --- Presenters (pure; flatten the deep API shapes into model-friendly views) ---

const SLOTS = 10;

function nonEmpty(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

/**
 * Per-set prescriptions from the param_N_data slots, e.g. ["5 @ 225", "3 @ 245"] or ["AMRAP"].
 * Values are kept raw (a non-numeric prescription like "AMRAP" or "8-12" must survive); the
 * positional units come from the exercise's param types, mirroring the coach presenter.
 */
function prescribedSets(ex: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (let i = 1; i <= SLOTS; i += 1) {
    const p1 = ex[`param_1_data_${i}`];
    const p2 = ex[`param_2_data_${i}`];
    const has1 = nonEmpty(p1);
    const has2 = nonEmpty(p2);
    if (!has1 && !has2) continue;
    if (has1 && has2) out.push(`${p1} @ ${p2}`);
    else if (has1) out.push(String(p1));
    else out.push(`@ ${p2}`);
  }
  return out;
}

function presentExercise(ex: Record<string, unknown>): AthleteWorkoutExercise {
  const instruction =
    typeof ex.instruction === "string" && ex.instruction !== "" ? ex.instruction : null;
  return {
    exerciseId: coerceInt(ex.exercise_id),
    title: typeof ex.title === "string" ? ex.title : "",
    instruction,
    units: exerciseUnits(ex.param_1_type, ex.param_2_type),
    prescribed: prescribedSets(ex),
  };
}

function presentBlock(set: Record<string, unknown>): AthleteWorkoutBlock {
  const exercises = Array.isArray(set.workoutSetExercises) ? set.workoutSetExercises : [];
  return {
    order: coerceInt(set.order) ?? 0,
    title: typeof set.title === "string" && set.title !== "" ? set.title : null,
    instruction:
      typeof set.instruction === "string" && set.instruction !== "" ? set.instruction : null,
    isTest: coerceInt(set.is_test) === 1,
    exercises: exercises.filter(isRecord).map(presentExercise),
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Flatten one `/3.0/athlete/programworkout/range` item into a readable workout. */
export function presentAthleteWorkout(raw: ProgramWorkout): AthleteWorkoutView {
  const rec = raw as Record<string, unknown>;
  const ssw = isRecord(rec.summarizedSavedWorkout) ? rec.summarizedSavedWorkout : {};
  const workout = isRecord(ssw.workout) ? ssw.workout : {};
  const sets = Array.isArray(workout.workoutSets) ? workout.workoutSets : [];
  return {
    id: coerceInt(rec.id),
    date: str(rec.date) ?? "",
    title: str(rec.workout_title) ?? "",
    program: str(rec.program_title),
    team: str(rec.team_title),
    instruction: str(workout.instruction),
    blocks: sets
      .filter(isRecord)
      .map(presentBlock)
      .sort((a, b) => a.order - b.order),
  };
}

export function presentAthleteWorkouts(list: readonly ProgramWorkout[]): AthleteWorkoutView[] {
  return list.map(presentAthleteWorkout);
}

// --- Set logging write path ---

const MAX_PARAM_SLOTS = 10;

/**
 * One set of entered values for a single exercise within a saved workout set.
 * `param1` and `param2` correspond to the exercise's first and second parameter types
 * (e.g. reps and weight). At most 10 sets are supported.
 */
export type SetResult = {
  savedWorkoutSetExerciseId: number;
  sets: Array<{ param1?: number | string; param2?: number | string }>;
};

/**
 * Build the body for `PUT /1.0/athlete/savedworkoutsetexercise/{id}`. The body uses
 * snake_case keys matching the live API response shape. Each set slot (1-10) gets a
 * `param_N_made` flag (1 if data is present, 0 otherwise) and `param_1_data_N` /
 * `param_2_data_N` string values.
 *
 * Only `savedWorkoutSetExerciseId`, `savedWorkoutSetId`, and `workoutSetExerciseId` are
 * required from the live exercise record; everything else is derived from `results`.
 *
 * Exported for unit testing — callers should use `logAthleteSet` instead.
 */
export function buildExerciseLogPayload(
  savedWorkoutSetExerciseId: number,
  savedWorkoutSetId: number,
  workoutSetExerciseId: number,
  results: readonly { param1?: number | string; param2?: number | string }[],
): Record<string, unknown> {
  if (results.length > MAX_PARAM_SLOTS) {
    throw new Error(
      `At most ${MAX_PARAM_SLOTS} sets are supported per exercise; got ${results.length}.`,
    );
  }
  const body: Record<string, unknown> = {
    id: savedWorkoutSetExerciseId,
    saved_workout_set_id: savedWorkoutSetId,
    workout_set_exercise_id: workoutSetExerciseId,
    completed: results.some((s) => s.param1 !== undefined || s.param2 !== undefined) ? 1 : 0,
  };
  for (let i = 1; i <= MAX_PARAM_SLOTS; i += 1) {
    const slot = results[i - 1];
    const p1 = slot?.param1 !== undefined ? String(slot.param1) : "";
    const p2 = slot?.param2 !== undefined ? String(slot.param2) : "";
    body[`param_${i}_made`] = p1 !== "" || p2 !== "" ? 1 : 0;
    body[`param_1_data_${i}`] = p1;
    body[`param_2_data_${i}`] = p2;
  }
  return body;
}

/**
 * Locate the target saved workout set across all program workouts on the given day.
 * Returns the `savedWorkoutId`, the matching set's `workoutSetExercises` array so callers
 * can look up `workout_set_exercise_id` by `savedWorkoutSetExerciseId`, and the raw set
 * record so callers can build the set-completion PUT body via `buildSetCompletePayload`.
 */
export function findSavedWorkoutSet(
  workouts: readonly ProgramWorkout[],
  savedWorkoutSetId: number,
): {
  savedWorkoutId: number;
  exercises: Record<string, unknown>[];
  rawSet: Record<string, unknown>;
} {
  for (const pw of workouts) {
    const rec = pw as Record<string, unknown>;
    const ssw = isRecord(rec.summarizedSavedWorkout) ? rec.summarizedSavedWorkout : {};
    const sw = isRecord(ssw.saved_workout) ? ssw.saved_workout : null;
    if (!sw) continue;
    const sets = Array.isArray(sw.workoutSets) ? sw.workoutSets : [];
    for (const s of sets) {
      if (!isRecord(s)) continue;
      if (coerceInt(s.id) === savedWorkoutSetId) {
        const savedWorkoutId = coerceInt(sw.id);
        if (!savedWorkoutId) continue;
        const exercises = Array.isArray(s.workoutSetExercises)
          ? (s.workoutSetExercises as unknown[]).filter(isRecord)
          : [];
        return { savedWorkoutId, exercises, rawSet: s };
      }
    }
  }
  throw new Error(`Saved workout set ${savedWorkoutSetId} not found on this date.`);
}

/**
 * Build the body for `PUT /1.0/athlete/savedworkoutset/{id}` that marks the set completed.
 *
 * The API requires the **app's camelCase in-memory model**, not the snake_case shape the
 * GET endpoints return. Key field mappings from the raw set record:
 *   saved_workout_id   → sessionId
 *   workout_set_id     → workoutSetId
 *   is_super_set (0/1) → isSuperSet (boolean)
 *   plain_text (0/1)   → isPlainText (boolean)
 *   unit ("lb"/"kg")   → isMetric (boolean)
 *   workoutSetExercises[].id → exercises (array of IDs)
 *
 * `exerciseIds` must be the savedWorkoutSetExercise IDs (not workout_set_exercise_ids).
 *
 * Exported for unit testing — callers should use `logAthleteSet` instead.
 */
export function buildSetCompletePayload(
  rawSet: Record<string, unknown>,
  exerciseIds: readonly number[],
  complete: boolean,
): Record<string, unknown> {
  const id = coerceInt(rawSet.id);
  const sessionId = coerceInt(rawSet.saved_workout_id);
  const workoutSetId = coerceInt(rawSet.workout_set_id);
  if (!id || !sessionId || !workoutSetId) {
    throw new Error("Raw set is missing required id / saved_workout_id / workout_set_id.");
  }
  const unit = typeof rawSet.unit === "string" ? rawSet.unit : "";
  return {
    id,
    sessionId,
    workoutSetId,
    completed: complete ? "1" : "0",
    rx: coerceInt(rawSet.rx) ?? 0,
    version: coerceInt(rawSet.version) ?? 0,
    isMetric: unit.toLowerCase() === "kg",
    isSuperSet: rawSet.is_super_set === 1 || rawSet.is_super_set === true,
    isPlainText: rawSet.plain_text === 1 || rawSet.plain_text === true,
    title: typeof rawSet.title === "string" ? rawSet.title : "",
    instruction: typeof rawSet.instruction === "string" ? rawSet.instruction : "",
    notes: rawSet.notes ?? null,
    exercises: [...exerciseIds],
  };
}

/**
 * Record entered set results for one saved workout set.
 *
 * **Two-step write (both required for data to persist):**
 * 1. For each exercise in `results`:
 *    `PUT /1.0/athlete/savedworkoutsetexercise/{savedWorkoutSetExerciseId}` with the
 *    per-slot `param_N_data_M` values. This is the only path that actually stores reps
 *    and weight — the `savedworkoutset` PUT accepts the same fields but silently discards
 *    them.
 * 2. `PUT /1.0/athlete/savedworkoutset/{savedWorkoutSetId}` with `completed:"1"` to
 *    mark the block done and make the entry visible as a logged set in history.
 *
 * The date is used to locate the saved workout (via the range endpoint) so we can resolve
 * `saved_workout_id` and `workout_set_exercise_id` for each exercise. Both are required
 * by the respective PUT bodies.
 */
export async function logAthleteSet(
  client: TrainHeroicClient,
  args: { date: string; savedWorkoutSetId: number; results: readonly SetResult[] },
): Promise<{ savedWorkoutSetId: number; exercisesLogged: number }> {
  // Step 0: fetch the range to locate the set and its exercises.
  const workouts = await fetchAthleteWorkouts(client, args.date, args.date);
  const { exercises, rawSet } = findSavedWorkoutSet(workouts, args.savedWorkoutSetId);

  // Step 1: PUT each exercise's data to its own endpoint.
  let exercisesLogged = 0;
  for (const result of args.results) {
    const ex = exercises.find((e) => coerceInt(e.id) === result.savedWorkoutSetExerciseId);
    if (!ex) {
      throw new Error(
        `savedWorkoutSetExerciseId ${result.savedWorkoutSetExerciseId} not found in saved workout set ${args.savedWorkoutSetId}.`,
      );
    }
    const workoutSetExerciseId = coerceInt(ex.workout_set_exercise_id);
    if (!workoutSetExerciseId) {
      throw new Error(
        `Could not resolve workout_set_exercise_id for exercise ${result.savedWorkoutSetExerciseId}.`,
      );
    }
    const body = buildExerciseLogPayload(
      result.savedWorkoutSetExerciseId,
      args.savedWorkoutSetId,
      workoutSetExerciseId,
      result.sets,
    );
    const res = await client.request(
      "PUT",
      `/1.0/athlete/savedworkoutsetexercise/${result.savedWorkoutSetExerciseId}`,
      {
        body,
      },
    );
    if (!res.ok) {
      throw new Error(
        `Failed to log exercise ${result.savedWorkoutSetExerciseId} (HTTP ${res.status}).`,
      );
    }
    exercisesLogged += 1;
  }

  // Step 2: mark the set as completed on the set-level endpoint.
  // The API requires the app's camelCase in-memory shape, built from the raw set record.
  // The exercises array must list all savedWorkoutSetExercise IDs in the set (not just the
  // ones the caller logged), so we pass the full list from the live set record.
  const allExerciseIds = exercises
    .map((e) => coerceInt(e.id))
    .filter((n): n is number => n !== null);
  const setBody = buildSetCompletePayload(rawSet, allExerciseIds, true);
  const setRes = await client.request(
    "PUT",
    `/1.0/athlete/savedworkoutset/${args.savedWorkoutSetId}`,
    { body: setBody },
  );
  if (!setRes.ok) {
    throw new Error(
      `Failed to mark workout set ${args.savedWorkoutSetId} completed (HTTP ${setRes.status}).`,
    );
  }

  return { savedWorkoutSetId: args.savedWorkoutSetId, exercisesLogged };
}

export type PersonalWorkoutCreated = {
  programWorkoutId: number;
  workoutId: number;
  savedWorkoutId: number;
  groupId: number;
  date: string;
};

/**
 * POST /v5/programWorkouts/personal — create a personal workout session for a given date.
 * Returns the key ids: workoutId (needed for addExercisesToWorkout), programWorkoutId,
 * savedWorkoutId, and groupId.
 */
export async function createPersonalWorkout(
  client: TrainHeroicClient,
  date: string,
): Promise<PersonalWorkoutCreated> {
  const res = await client.request<unknown>("POST", "/v5/programWorkouts/personal", {
    body: { date },
  });
  if (!res.ok) throw new Error(`Create personal workout failed (HTTP ${res.status}).`);
  if (!isRecord(res.data))
    throw new Error("Unexpected response from /v5/programWorkouts/personal.");
  const pw = isRecord(res.data.programWorkout) ? res.data.programWorkout : null;
  const sw = isRecord(res.data.savedWorkout) ? res.data.savedWorkout : null;
  if (!pw || !sw) throw new Error("Missing programWorkout or savedWorkout in response.");
  const programWorkoutId = coerceInt(pw.id);
  const workoutId = coerceInt(pw.workoutId);
  const savedWorkoutId = coerceInt(sw.id);
  const groupId = coerceInt(sw.group_id);
  if (!programWorkoutId || !workoutId || !savedWorkoutId || !groupId) {
    throw new Error("Could not parse required ids from personal workout response.");
  }
  return {
    programWorkoutId,
    workoutId,
    savedWorkoutId,
    groupId,
    date: typeof pw.date === "string" ? pw.date : date,
  };
}

/** One exercise item for addExercisesToWorkout. */
export type AddedExercise = { exerciseId: number; order: number };

/**
 * PUT /v5/personalCalendar/workouts/{workoutId}/addExercises — add exercises to a personal
 * workout. Returns saved workout set objects: each top-level `id` is a savedWorkoutSetId
 * and `savedWorkoutSetExercises[].id` is a savedWorkoutSetExerciseId, both needed by
 * logAthleteSet.
 */
export async function addExercisesToWorkout(
  client: TrainHeroicClient,
  workoutId: number,
  exercises: AddedExercise[],
): Promise<unknown> {
  const res = await client.request<unknown>(
    "PUT",
    `/v5/personalCalendar/workouts/${workoutId}/addExercises`,
    { body: { exercises, circuits: [] } },
  );
  if (!res.ok) throw new Error(`Add exercises to workout failed (HTTP ${res.status}).`);
  return res.data;
}

/** Flatten `/v5/exercises/{id}/history` into PRs + a session time-series. */
export function presentExerciseHistory(detail: ExerciseHistoryDetail): PresentedExerciseHistory {
  const liftPRs = (detail.liftPRs ?? []).map((p) => ({
    description: p.description ?? null,
    reps: p.reps ?? null,
    weight: p.weight ?? null,
    date: p.dateCompleted ?? null,
  }));
  const sessions = (detail.history ?? []).map((h) => ({
    date: h.dateCompleted,
    abr: h.abr ?? null,
    estimated1RM: h.bestEstimated1RM ?? null,
    sets: (h.sets ?? []).map((s) => ({
      setNumber: s.setNumber,
      value: s.formattedValue ?? null,
    })),
  }));
  return { liftPRs, sessions };
}
