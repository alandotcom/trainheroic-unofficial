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
  AthleteWorkoutSummary,
  AthleteWorkoutView,
  CoachAthleteExercise,
  CoachAthleteSession,
  CoachAthleteTraining,
  ExerciseHistoryDetail,
  ExerciseHistoryListItem,
  ExerciseStats,
  PersonalRecord,
  PresentedExerciseHistory,
  ProgramWorkout,
  RosterActivityRow,
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

/**
 * Sort a roster-activity list most-recently-active first; never-logged rows (null date) last.
 * Athletes tied on lastLoggedDate break by session count (more sessions first), so a tie is not
 * left to arbitrary input order.
 */
export function sortRosterByRecency(rows: readonly RosterActivityRow[]): RosterActivityRow[] {
  return [...rows].sort((a, b) => {
    if (a.lastLoggedDate !== b.lastLoggedDate) {
      if (a.lastLoggedDate === null) return 1;
      if (b.lastLoggedDate === null) return -1;
      return a.lastLoggedDate < b.lastLoggedDate ? 1 : -1;
    }
    return (b.sessionsCount ?? 0) - (a.sessionsCount ?? 0);
  });
}

/**
 * A coach's roster-activity ranking: each athlete's all-time training snapshot (session count,
 * first/last logged date, total reps/volume), sorted most-recently-active first. There is no
 * single roster-activity endpoint, so this fans out `/v5/athleteProfile/summary` per athlete with
 * a small concurrency cap; pass the subset you care about for a large org. A failed or missing
 * summary becomes a null-data row (sorted last), not an error.
 */
export async function fetchRosterActivity(
  client: TrainHeroicClient,
  athleteIds: readonly number[],
  useMetric = false,
): Promise<RosterActivityRow[]> {
  const rows: RosterActivityRow[] = [];
  const concurrency = 6;
  for (let i = 0; i < athleteIds.length; i += concurrency) {
    const chunk = athleteIds.slice(i, i + concurrency);
    const settled = await Promise.all(
      chunk.map(async (id) => {
        try {
          return { id, summary: await fetchAthleteProfileSummary(client, id, useMetric) };
        } catch {
          return { id, summary: null };
        }
      }),
    );
    for (const { id, summary } of settled) {
      const count = summary?.sessions_count ?? null;
      // The summary endpoint returns the epoch placeholder "1970-01-01" (not null) for an athlete
      // who has never logged. Normalize that — and any date when the session count is 0 — to null,
      // so a null lastLoggedDate means exactly "never logged".
      const hasSessions = count !== null && count > 0;
      const normDate = (d: string | undefined): string | null =>
        hasSessions && d !== undefined && d !== "" && !d.startsWith("1970") ? d : null;
      rows.push({
        athleteId: id,
        sessionsCount: count,
        firstLoggedDate: normDate(summary?.first_logged_date),
        lastLoggedDate: normDate(summary?.last_logged_date),
        totalReps: summary?.reps_sum ?? null,
        totalVolume: summary?.volume_sum ?? null,
      });
    }
  }
  return sortRosterByRecency(rows);
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

/**
 * A coach's view of a roster athlete's scheduled + completed workouts in an inclusive
 * YYYY-MM-DD window (`/3.0/coach/athlete/programworkout/range/{athleteId}`). Returns the same
 * `ProgramWorkout[]` shape as `fetchAthleteWorkouts`, so the same presenters and
 * `findSavedWorkoutSet` apply — it just reads another athlete's data through the coach surface.
 */
export function fetchCoachAthleteWorkouts(
  client: TrainHeroicClient,
  athleteId: number,
  startDate: string,
  endDate: string,
): Promise<ProgramWorkout[]> {
  return getArray(
    client,
    `/3.0/coach/athlete/programworkout/range/${athleteId}?startDate=${startDate}&endDate=${endDate}`,
    "coach athlete workouts",
  );
}

/**
 * A coach's month view of a roster athlete's logged sessions
 * (`/2.0/coach/athlete/calendar/summary`). The trailing path segment is required by the API but
 * ignored (any value returns the whole month); it mirrors the coach web app, which sends 7. The
 * `userId` in each row is the roster athlete, not the calling coach.
 */
export function fetchCoachAthleteCalendarSummary(
  client: TrainHeroicClient,
  athleteId: number,
  year: number,
  month: number,
): Promise<unknown[]> {
  return getArray(
    client,
    `/2.0/coach/athlete/calendar/summary/${athleteId}/${year}/${month}/7`,
    "coach athlete calendar summary",
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

/**
 * The per-set values the athlete actually logged, read from a saved-copy exercise. A set
 * counts as performed only when its `param_{i}_made` flag is 1: the saved copy pre-fills the
 * `param_N_data` slots with the prescription, so the presence of data alone does not mean a
 * set was done. `param_{i}_made` is the same per-set flag the logging write sets, and is the
 * only reliable signal (the `completed` flags are often left at 0 on a logged session).
 */
function performedSets(ex: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (let i = 1; i <= SLOTS; i += 1) {
    if (coerceInt(ex[`param_${i}_made`]) !== 1) continue;
    const p1 = ex[`param_1_data_${i}`];
    const p2 = ex[`param_2_data_${i}`];
    const has1 = nonEmpty(p1);
    const has2 = nonEmpty(p2);
    if (has1 && has2) out.push(`${p1} @ ${p2}`);
    else if (has1) out.push(String(p1));
    else if (has2) out.push(`@ ${p2}`);
  }
  return out;
}

function presentExercise(
  ex: Record<string, unknown>,
  performedById: Map<number, string[]>,
): AthleteWorkoutExercise {
  const instruction =
    typeof ex.instruction === "string" && ex.instruction !== "" ? ex.instruction : null;
  const id = coerceInt(ex.id);
  return {
    exerciseId: coerceInt(ex.exercise_id),
    title: typeof ex.title === "string" ? ex.title : "",
    instruction,
    units: exerciseUnits(ex.param_1_type, ex.param_2_type),
    prescribed: prescribedSets(ex),
    performed: (id !== null ? performedById.get(id) : undefined) ?? [],
  };
}

function presentBlock(
  set: Record<string, unknown>,
  performedById: Map<number, string[]>,
): AthleteWorkoutBlock {
  const exercises = Array.isArray(set.workoutSetExercises) ? set.workoutSetExercises : [];
  return {
    order: coerceInt(set.order) ?? 0,
    title: typeof set.title === "string" && set.title !== "" ? set.title : null,
    instruction:
      typeof set.instruction === "string" && set.instruction !== "" ? set.instruction : null,
    isTest: coerceInt(set.is_test) === 1,
    exercises: exercises.filter(isRecord).map((ex) => presentExercise(ex, performedById)),
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Every logged set (programmed + athlete-added) in the saved copy, paired with its exercises. */
function savedSets(
  saved: Record<string, unknown>,
): Array<{ set: Record<string, unknown>; exercises: Record<string, unknown>[] }> {
  const out: Array<{ set: Record<string, unknown>; exercises: Record<string, unknown>[] }> = [];
  for (const key of ["workoutSets", "addedWorkoutSets"] as const) {
    const sets = Array.isArray(saved[key]) ? saved[key] : [];
    for (const set of sets) {
      if (!isRecord(set)) continue;
      const exercises = (
        Array.isArray(set.workoutSetExercises) ? set.workoutSetExercises : []
      ).filter(isRecord);
      out.push({ set, exercises });
    }
  }
  return out;
}

/**
 * Map each prescription exercise id to the per-set values the athlete logged. In the saved
 * copy, `workout_set_exercise_id` points back at the prescription exercise's `id`, and the
 * entered values live in the same `param_N_data` slots as a prescription — so the
 * prescription reader works on them unchanged.
 */
function performedByExerciseId(
  sets: Array<{ exercises: Record<string, unknown>[] }>,
): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const { exercises } of sets) {
    for (const ex of exercises) {
      const id = coerceInt(ex.workout_set_exercise_id);
      if (id === null) continue;
      const values = performedSets(ex);
      if (values.length > 0) map.set(id, values);
    }
  }
  return map;
}

/** Present a logged set straight from the saved copy (athlete-added or personal work). */
function presentSavedBlock(
  set: Record<string, unknown>,
  exercises: Record<string, unknown>[],
): AthleteWorkoutBlock {
  return {
    order: coerceInt(set.order) ?? 0,
    title: typeof set.title === "string" && set.title !== "" ? set.title : null,
    instruction:
      typeof set.instruction === "string" && set.instruction !== "" ? set.instruction : null,
    isTest: coerceInt(set.is_test) === 1,
    exercises: exercises.map((ex) => ({
      exerciseId: coerceInt(ex.exercise_id),
      title: typeof ex.exercise_title === "string" ? ex.exercise_title : "",
      instruction:
        typeof ex.instruction === "string" && ex.instruction !== "" ? ex.instruction : null,
      units: exerciseUnits(ex.param_1_type, ex.param_2_type),
      prescribed: [],
      performed: performedSets(ex),
    })),
  };
}

/**
 * Flatten one `/3.0/athlete/programworkout/range` item into a readable workout, merging the
 * prescription (`summarizedSavedWorkout.workout`) with what the athlete logged
 * (`summarizedSavedWorkout.saved_workout`). Each exercise carries both its `prescribed` and
 * `performed` sets; athlete-added/personal work that has no prescription is appended as its
 * own blocks. No `raw` is needed to see logged results.
 */
export function presentAthleteWorkout(raw: ProgramWorkout): AthleteWorkoutView {
  const rec = raw as Record<string, unknown>;
  const ssw = isRecord(rec.summarizedSavedWorkout) ? rec.summarizedSavedWorkout : {};
  const workout = isRecord(ssw.workout) ? ssw.workout : {};
  const saved = isRecord(ssw.saved_workout) ? ssw.saved_workout : {};
  const prescriptionSets = (Array.isArray(workout.workoutSets) ? workout.workoutSets : []).filter(
    isRecord,
  );

  const logged = savedSets(saved);
  const performedById = performedByExerciseId(logged);

  // Prescription blocks, each exercise enriched with what the athlete actually logged.
  const blocks = prescriptionSets
    .map((s) => presentBlock(s, performedById))
    .sort((a, b) => a.order - b.order);

  // Logged sets with no matching prescription (athlete-added work, personal sessions).
  const prescribedIds = new Set<number>();
  for (const s of prescriptionSets) {
    const exs = Array.isArray(s.workoutSetExercises) ? s.workoutSetExercises : [];
    for (const ex of exs) {
      if (!isRecord(ex)) continue;
      const id = coerceInt(ex.id);
      if (id !== null) prescribedIds.add(id);
    }
  }
  for (const { set, exercises } of logged) {
    const extra = exercises.filter((ex) => {
      if (performedSets(ex).length === 0) return false;
      const id = coerceInt(ex.workout_set_exercise_id);
      return id === null || !prescribedIds.has(id);
    });
    if (extra.length > 0) blocks.push(presentSavedBlock(set, extra));
  }

  return {
    id: coerceInt(rec.id),
    date: str(rec.date) ?? "",
    title: str(rec.workout_title) ?? "",
    program: str(rec.program_title),
    team: str(rec.team_title),
    instruction: str(workout.instruction),
    logged: blocks.some((b) => b.exercises.some((e) => e.performed.length > 0)),
    blocks,
  };
}

export function presentAthleteWorkouts(list: readonly ProgramWorkout[]): AthleteWorkoutView[] {
  return list.map(presentAthleteWorkout);
}

/** The minimal id scaffold `log-set` / `logForAthlete` needs for one saved workout set. */
export type LogSetTarget = {
  date: string;
  workoutTitle: string;
  /** The program this saved workout belongs to — lets a caller pick the right one of several. */
  program: string | null;
  programId: number | null;
  team: string | null;
  teamId: number | null;
  /** The id for `--set` (logAthleteSet/logForAthlete `savedWorkoutSetId`). */
  savedWorkoutSetId: number;
  setTitle: string | null;
  exercises: Array<{
    /** The id for each result's `savedWorkoutSetExerciseId`. */
    savedWorkoutSetExerciseId: number;
    title: string;
    units: ReturnType<typeof exerciseUnits>;
    prescribed: string[];
    performed: string[];
  }>;
};

/**
 * Narrow a coach-athlete workout range to a single program or team. The range endpoint returns
 * every program the athlete is enrolled in on a date; for a high-enrollment athlete that is many
 * workouts, so a caller wanting one program's session passes its programId (or teamId) to keep the
 * result small. Matches the raw `program_id` / `team_id` on each workout. With neither id given the
 * list is returned unchanged.
 */
export function selectWorkoutsByProgram(
  list: readonly ProgramWorkout[],
  filter: { programId?: number; teamId?: number },
): ProgramWorkout[] {
  const { programId, teamId } = filter;
  if (programId === undefined && teamId === undefined) return [...list];
  return list.filter((pw) => {
    const rec = pw as Record<string, unknown>;
    if (programId !== undefined && coerceInt(rec.program_id) === programId) return true;
    if (teamId !== undefined && coerceInt(rec.team_id) === teamId) return true;
    return false;
  });
}

/**
 * Project a workout range to just the ids a set-log write needs, read from the SAME saved-copy
 * location {@link findSavedWorkoutSet} matches against (`summarizedSavedWorkout.saved_workout`).
 * This is the self-service path for logging: instead of grepping the multi-KB `--raw` blob for
 * which of several id fields maps to `--set`, callers read `savedWorkoutSetId` and each
 * `savedWorkoutSetExerciseId` straight off these rows. Each target also carries its program/team
 * so a caller can pick the right session when the athlete is on several. One row per saved set,
 * dropping any set with no resolvable id.
 */
export function presentLogTargets(list: readonly ProgramWorkout[]): LogSetTarget[] {
  const targets: LogSetTarget[] = [];
  for (const pw of list) {
    const rec = pw as Record<string, unknown>;
    const ssw = isRecord(rec.summarizedSavedWorkout) ? rec.summarizedSavedWorkout : {};
    const saved = isRecord(ssw.saved_workout) ? ssw.saved_workout : null;
    if (!saved) continue;
    const date = str(rec.date) ?? "";
    const workoutTitle = str(rec.workout_title) ?? "";
    const program = str(rec.program_title);
    const programId = coerceInt(rec.program_id);
    const team = str(rec.team_title);
    const teamId = coerceInt(rec.team_id);
    const sets = Array.isArray(saved.workoutSets) ? saved.workoutSets : [];
    for (const s of sets) {
      if (!isRecord(s)) continue;
      const savedWorkoutSetId = coerceInt(s.id);
      if (savedWorkoutSetId === null) continue;
      const exRecords = (Array.isArray(s.workoutSetExercises) ? s.workoutSetExercises : []).filter(
        isRecord,
      );
      const exercises = exRecords
        .map((ex) => {
          const id = coerceInt(ex.id);
          if (id === null) return null;
          return {
            savedWorkoutSetExerciseId: id,
            title:
              (typeof ex.exercise_title === "string" && ex.exercise_title) ||
              (typeof ex.title === "string" && ex.title) ||
              "",
            units: exerciseUnits(ex.param_1_type, ex.param_2_type),
            prescribed: prescribedSets(ex),
            performed: performedSets(ex),
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
      targets.push({
        date,
        workoutTitle,
        program,
        programId,
        team,
        teamId,
        savedWorkoutSetId,
        setTitle: str(s.title),
        exercises,
      });
    }
  }
  return targets;
}

/**
 * Narrow a presented workout list for the common "what did I actually do" reads. `loggedOnly`
 * keeps only workouts the athlete logged a set on (the reliable signal, not the API's
 * completion flag). `limit` keeps the most recent N by date (newest first). Both are pure
 * post-filters over the presented view; the raw API path is left untouched.
 */
export function selectWorkouts(
  list: readonly AthleteWorkoutView[],
  opts: { loggedOnly?: boolean; limit?: number } = {},
): AthleteWorkoutView[] {
  let out = opts.loggedOnly === true ? list.filter((w) => w.logged) : [...list];
  if (opts.limit !== undefined) {
    out = [...out]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, opts.limit);
  }
  return out;
}

/**
 * Project presented workouts to compact headers (date/title/program + logged flag + exercise
 * counts), dropping the per-set block detail. A dense multi-program week of full views can be
 * tens of KB; this keeps an overview question to one small row per session, with a drill-in
 * (narrow the date range) when the detail is actually needed.
 */
export function summarizeAthleteWorkouts(
  list: readonly AthleteWorkoutView[],
): AthleteWorkoutSummary[] {
  return list.map((w) => {
    const exerciseCount = w.blocks.reduce((n, b) => n + b.exercises.length, 0);
    const performedCount = w.blocks.reduce(
      (n, b) => n + b.exercises.filter((e) => e.performed.length > 0).length,
      0,
    );
    return {
      id: w.id,
      date: w.date,
      title: w.title,
      program: w.program,
      team: w.team,
      logged: w.logged,
      exerciseCount,
      performedCount,
    };
  });
}

/**
 * Flatten the coach athlete-calendar summary into compact per-session rows: title, the `logged`
 * flag (the reliable did-they-train signal), rpe/duration/notes, and the exercises performed with
 * the API's own set summary string (`abr`, e.g. "5 x 2 @ 205 lb"). The exercise titles here are
 * the discovery handle a coach otherwise lacks: read what the athlete actually did, then pull the
 * specific lift's PRs.
 */
export function presentCoachAthleteTraining(
  raw: readonly unknown[],
  athleteId: number,
  year: number,
  month: number,
): CoachAthleteTraining {
  const sessions: CoachAthleteSession[] = [];
  let athleteName: string | null = null;
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (athleteName === null && typeof item.athleteName === "string") {
      athleteName = item.athleteName;
    }
    const exercises: CoachAthleteExercise[] = [];
    const sets = Array.isArray(item.sets) ? item.sets : [];
    for (const set of sets) {
      if (!isRecord(set)) continue;
      const exs = Array.isArray(set.exercises) ? set.exercises : [];
      for (const ex of exs) {
        if (!isRecord(ex)) continue;
        exercises.push({
          exerciseId: coerceInt(ex.exercise_id),
          title: typeof ex.title === "string" ? ex.title : "",
          summary: typeof ex.abr === "string" && ex.abr !== "" ? ex.abr : null,
          completed: coerceInt(ex.completed) === 1,
        });
      }
    }
    sessions.push({
      workoutId: coerceInt(item.workout_id),
      savedWorkoutId: coerceInt(item.saved_workout_id),
      title: typeof item.workout_title === "string" ? item.workout_title : "",
      logged: coerceInt(item.logged) === 1,
      completed: coerceInt(item.completed) === 1,
      rpe: coerceInt(item.rpe),
      durationMin: coerceInt(item.session_duration),
      notes: typeof item.notes === "string" && item.notes !== "" ? item.notes : null,
      exercises,
    });
  }
  return { athleteId, athleteName, year, month, sessions };
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
 * Which write a set-write is: `"log"` records a performed result (and marks the set done),
 * `"prescribe"` sets prescribed targets without marking it done. Threaded through
 * {@link buildExerciseSetPayload} and the set-write helper so the two contracts share one path.
 */
export type SetWriteMode = "log" | "prescribe";

/**
 * Coerce the loosely-typed `results` from a validated log/prescribe args object into the SDK's
 * {@link SetResult}[]. The dto schemas validate ids as a number or a numeric string and leave
 * empty param slots optional; this narrows the id to a number and copies only the present per-set
 * values (so the per-set type stays free of `undefined` under exactOptionalPropertyTypes). Shared
 * by the MCP tools and the CLI so the mapping lives in one place rather than once per surface.
 */
export function toSetResults(
  results: ReadonlyArray<{
    savedWorkoutSetExerciseId: number | string;
    sets: ReadonlyArray<{
      param1?: number | string | undefined;
      param2?: number | string | undefined;
    }>;
  }>,
): SetResult[] {
  return results.map((r) => {
    const id = coerceInt(r.savedWorkoutSetExerciseId);
    if (id === null) {
      throw new Error(`Invalid savedWorkoutSetExerciseId: ${String(r.savedWorkoutSetExerciseId)}`);
    }
    return {
      savedWorkoutSetExerciseId: id,
      sets: r.sets.map((s) => {
        const slot: { param1?: number | string; param2?: number | string } = {};
        if (s.param1 !== undefined) slot.param1 = s.param1;
        if (s.param2 !== undefined) slot.param2 = s.param2;
        return slot;
      }),
    };
  });
}

/**
 * Build the body for `PUT /1.0/{role}/savedworkoutsetexercise/{id}`. The body uses snake_case
 * keys matching the live API response shape. Each set slot (1-10) carries `param_1_data_N` /
 * `param_2_data_N` string values plus a `param_N_made` flag.
 *
 * `mode` selects which write this is — the same endpoint serves both:
 *   - `"log"`: the values ARE a performed result, so `param_N_made` is 1 where the slot has data
 *     and the exercise `completed` flag is 1 when any set has data.
 *   - `"prescribe"`: the values are prescribed targets, written with every `param_N_made` and
 *     `completed` left at 0 so the set is not marked done. This matches what the app sends when a
 *     coach edits an athlete's prescribed reps/weight.
 *
 * Only `savedWorkoutSetExerciseId`, `savedWorkoutSetId`, and `workoutSetExerciseId` are
 * required from the live exercise record; everything else is derived from `results`.
 *
 * Exported for unit testing — callers should use `logAthleteSet` / `prescribeForAthlete` instead.
 */
export function buildExerciseSetPayload(
  savedWorkoutSetExerciseId: number,
  savedWorkoutSetId: number,
  workoutSetExerciseId: number,
  results: readonly { param1?: number | string; param2?: number | string }[],
  mode: SetWriteMode,
): Record<string, unknown> {
  if (results.length > MAX_PARAM_SLOTS) {
    throw new Error(
      `At most ${MAX_PARAM_SLOTS} sets are supported per exercise; got ${results.length}.`,
    );
  }
  const performed = mode === "log";
  const hasData = results.some((s) => s.param1 !== undefined || s.param2 !== undefined);
  const body: Record<string, unknown> = {
    id: savedWorkoutSetExerciseId,
    saved_workout_set_id: savedWorkoutSetId,
    workout_set_exercise_id: workoutSetExerciseId,
    completed: performed && hasData ? 1 : 0,
  };
  for (let i = 1; i <= MAX_PARAM_SLOTS; i += 1) {
    const slot = results[i - 1];
    const p1 = slot?.param1 !== undefined ? String(slot.param1) : "";
    const p2 = slot?.param2 !== undefined ? String(slot.param2) : "";
    body[`param_${i}_made`] = performed && (p1 !== "" || p2 !== "") ? 1 : 0;
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
  // Collected as we scan, so a miss can show the caller the ids that ARE on this date — the
  // single biggest log-set confusion is picking the wrong id field for --set.
  const available: string[] = [];
  for (const pw of workouts) {
    const rec = pw as Record<string, unknown>;
    const ssw = isRecord(rec.summarizedSavedWorkout) ? rec.summarizedSavedWorkout : {};
    const sw = isRecord(ssw.saved_workout) ? ssw.saved_workout : null;
    if (!sw) continue;
    const sets = Array.isArray(sw.workoutSets) ? sw.workoutSets : [];
    for (const s of sets) {
      if (!isRecord(s)) continue;
      const exercises = Array.isArray(s.workoutSetExercises)
        ? (s.workoutSetExercises as unknown[]).filter(isRecord)
        : [];
      if (coerceInt(s.id) === savedWorkoutSetId) {
        const savedWorkoutId = coerceInt(sw.id);
        if (!savedWorkoutId) continue;
        return { savedWorkoutId, exercises, rawSet: s };
      }
      const setId = coerceInt(s.id);
      if (setId !== null) {
        const exLabels = exercises
          .map((ex) => {
            const exId = coerceInt(ex.id);
            const title =
              (typeof ex.exercise_title === "string" && ex.exercise_title) ||
              (typeof ex.title === "string" && ex.title) ||
              "exercise";
            return exId === null ? null : `${exId} (${title})`;
          })
          .filter((x): x is string => x !== null);
        available.push(`set ${setId} → exercise ids: ${exLabels.join(", ") || "none"}`);
      }
    }
  }
  const hint =
    available.length > 0
      ? ` Saved workout sets present on this date: ${available.join("; ")}. ` +
        `Pass a "set N" id to --set (the savedWorkoutSetId), and the matching "exercise id" as ` +
        `savedWorkoutSetExerciseId in the results.`
      : ` No saved workout is scheduled on this date — log against a date that has a workout (find ` +
        `it via athlete-workouts / coach athlete-workouts).`;
  throw new Error(`Saved workout set ${savedWorkoutSetId} not found on this date.${hint}`);
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
  const r = await writeSetResults(
    client,
    { role: "athlete" },
    workouts,
    args.savedWorkoutSetId,
    args.results,
    "log",
  );
  return { savedWorkoutSetId: r.savedWorkoutSetId, exercisesLogged: r.exercisesWritten };
}

/**
 * Coach "Log for Athlete": record set results for a roster athlete on their behalf, via the
 * coach surface — `PUT /1.0/coach/savedworkoutsetexercise/{id}/{athleteId}` (the data write)
 * then `PUT /1.0/coach/savedworkoutset/{id}/{athleteId}` (mark complete). Same two-step
 * contract as {@link logAthleteSet}; the bodies are identical except each is stamped with
 * `athleteId`. The day is located through the coach range endpoint for that athlete.
 *
 * NOTE: TrainHeroic's seeded *demo* athletes are read-only for results and return 401 on the
 * data-write step; real (invited) athletes accept it.
 */
export async function logForAthlete(
  client: TrainHeroicClient,
  args: {
    athleteId: number;
    date: string;
    savedWorkoutSetId: number;
    results: readonly SetResult[];
  },
): Promise<{ savedWorkoutSetId: number; exercisesLogged: number }> {
  const workouts = await fetchCoachAthleteWorkouts(client, args.athleteId, args.date, args.date);
  const r = await writeSetResults(
    client,
    { role: "coach", athleteId: args.athleteId },
    workouts,
    args.savedWorkoutSetId,
    args.results,
    "log",
  );
  return { savedWorkoutSetId: r.savedWorkoutSetId, exercisesLogged: r.exercisesWritten };
}

/**
 * Coach prescription override: set the prescribed reps/weight for one of a roster athlete's saved
 * workout sets WITHOUT marking it performed — the API equivalent of the app's editing an athlete's
 * prescribed values. Writes each exercise's per-set targets via
 * `PUT /1.0/coach/savedworkoutsetexercise/{id}/{athleteId}` with `param_N_made = 0` /
 * `completed = 0`, and (unlike {@link logForAthlete}) skips the set-completion step, so the set
 * stays open for the athlete to log against.
 *
 * Overrides only this athlete's copy of the set; the team/program prescription is untouched, so
 * other athletes on the same program keep the original targets. The write REPLACES the slot's
 * prescribed values, so pass the full per-set prescription you want — `param1` is reps, `param2`
 * is weight, and an omitted param is written empty (clearing it), not left as-is.
 *
 * NOTE: TrainHeroic's seeded *demo* athletes are read-only and return 401/403; real (invited)
 * athletes accept it.
 */
export async function prescribeForAthlete(
  client: TrainHeroicClient,
  args: {
    athleteId: number;
    date: string;
    savedWorkoutSetId: number;
    results: readonly SetResult[];
  },
): Promise<{ savedWorkoutSetId: number; exercisesPrescribed: number }> {
  const workouts = await fetchCoachAthleteWorkouts(client, args.athleteId, args.date, args.date);
  const r = await writeSetResults(
    client,
    { role: "coach", athleteId: args.athleteId },
    workouts,
    args.savedWorkoutSetId,
    args.results,
    "prescribe",
  );
  return { savedWorkoutSetId: r.savedWorkoutSetId, exercisesPrescribed: r.exercisesWritten };
}

/** Outcome of a per-athlete exercise swap: the slot that changed and what it changed to/from. */
export type SwapExerciseResult = {
  savedWorkoutSetExerciseId: number;
  /** The athlete who owns the slot (`user_id` off the updated row), when the API returns it. */
  athleteId: number | null;
  /** The exercise now scheduled in the slot. */
  newExerciseId: number;
  newExerciseTitle: string | null;
  /** The team/program's original prescription, left untouched (`workout_set_exercise.exercise_id`). */
  originalTeamExerciseId: number | null;
};

/**
 * Swap the exercise prescribed in one of an athlete's saved-workout slots for a different
 * exercise — the API equivalent of the app's per-athlete "swap exercise":
 * `PUT /v5/savedWorkoutSetExercises/{savedWorkoutSetExerciseId}?exerciseId={exerciseId}` with an
 * empty body. The new exercise rides in the query string, not the body.
 *
 * This overrides only this athlete's copy of the slot; the underlying team/program prescription
 * (`workout_set_exercise.exercise_id`) is untouched, so other athletes on the same program keep
 * the original exercise. A coach's session token may write another user's row because the row
 * already carries its owner's `user_id`.
 *
 * `savedWorkoutSetExerciseId` is the same id {@link logForAthlete}/{@link logAthleteSet} use,
 * read off the athlete's saved workouts (the raw view). `exerciseId` is any exercise id the org
 * can use (resolve one via the exercise index).
 *
 * NOTE: as with logging, TrainHeroic's seeded *demo* athletes are read-only and return 401/403;
 * real (invited) athletes accept the swap.
 */
export async function swapAthleteExercise(
  client: TrainHeroicClient,
  args: { savedWorkoutSetExerciseId: number; exerciseId: number },
): Promise<SwapExerciseResult> {
  const res = await client.request<unknown>(
    "PUT",
    `/v5/savedWorkoutSetExercises/${args.savedWorkoutSetExerciseId}?exerciseId=${args.exerciseId}`,
  );
  if (!res.ok) {
    const readOnly =
      res.status === 401 || res.status === 403
        ? ` Athlete may be read-only for changes — TrainHeroic's seeded demo/sample athletes ` +
          `return ${res.status} here; swaps only persist for real (invited) athletes.`
        : "";
    throw new Error(
      `Swap failed (HTTP ${res.status}) for savedWorkoutSetExercise ${args.savedWorkoutSetExerciseId}.${readOnly}`,
    );
  }
  const row = isRecord(res.data) ? res.data : {};
  const template = isRecord(row.workout_set_exercise) ? row.workout_set_exercise : {};
  const exercise = isRecord(row.exercise) ? row.exercise : {};
  return {
    savedWorkoutSetExerciseId: args.savedWorkoutSetExerciseId,
    athleteId: coerceInt(row.user_id),
    // A 2xx always echoes the swapped row; fall back to the requested id only for resilience to
    // a malformed success, not because the field is genuinely optional.
    newExerciseId: coerceInt(row.exercise_id) ?? args.exerciseId,
    newExerciseTitle: str(exercise.title),
    originalTeamExerciseId: coerceInt(template.exercise_id),
  };
}

/** Which API surface a set-log write targets: the athlete's own, or a coach acting on a roster athlete. */
type LogTarget = { role: "athlete" } | { role: "coach"; athleteId: number };

/**
 * Shared set-write behind {@link logAthleteSet}, {@link logForAthlete}, and
 * {@link prescribeForAthlete}. `target` selects the surface: `athlete` writes `/1.0/athlete/...`;
 * `coach` writes `/1.0/coach/...{athleteId}` and stamps `athleteId` into each body.
 *
 * Step 1 PUTs each exercise's per-set values to its own endpoint (the only path that actually
 * stores reps and weight). `mode` decides what those values mean: `"log"` records them as a
 * performed result and runs Step 2, which marks the set completed (that body needs the app's
 * camelCase in-memory shape and the full list of savedWorkoutSetExercise IDs in the set, not only
 * the written ones); `"prescribe"` writes them as a prescription and skips Step 2, leaving the set
 * open.
 */
async function writeSetResults(
  client: TrainHeroicClient,
  target: LogTarget,
  workouts: readonly ProgramWorkout[],
  savedWorkoutSetId: number,
  results: readonly SetResult[],
  mode: SetWriteMode,
): Promise<{ savedWorkoutSetId: number; exercisesWritten: number }> {
  const { exercises, rawSet } = findSavedWorkoutSet(workouts, savedWorkoutSetId);
  const suffix = target.role === "coach" ? `/${target.athleteId}` : "";
  const extra = target.role === "coach" ? { athleteId: target.athleteId } : {};

  // Step 1: PUT each exercise's data to its own endpoint.
  let exercisesWritten = 0;
  for (const result of results) {
    const ex = exercises.find((e) => coerceInt(e.id) === result.savedWorkoutSetExerciseId);
    if (!ex) {
      const valid = exercises
        .map((e) => {
          const id = coerceInt(e.id);
          const title =
            (typeof e.exercise_title === "string" && e.exercise_title) ||
            (typeof e.title === "string" && e.title) ||
            "exercise";
          return id === null ? null : `${id} (${title})`;
        })
        .filter((x): x is string => x !== null);
      throw new Error(
        `savedWorkoutSetExerciseId ${result.savedWorkoutSetExerciseId} not found in saved workout set ` +
          `${savedWorkoutSetId}. Exercises in this set: ${valid.join(", ") || "none"}.`,
      );
    }
    const workoutSetExerciseId = coerceInt(ex.workout_set_exercise_id);
    if (!workoutSetExerciseId) {
      throw new Error(
        `Could not resolve workout_set_exercise_id for exercise ${result.savedWorkoutSetExerciseId}.`,
      );
    }
    const body = {
      ...buildExerciseSetPayload(
        result.savedWorkoutSetExerciseId,
        savedWorkoutSetId,
        workoutSetExerciseId,
        result.sets,
        mode,
      ),
      ...extra,
    };
    const res = await client.request(
      "PUT",
      `/1.0/${target.role}/savedworkoutsetexercise/${result.savedWorkoutSetExerciseId}${suffix}`,
      { body },
    );
    if (!res.ok) {
      const readOnly =
        target.role === "coach" && (res.status === 401 || res.status === 403)
          ? ` Athlete ${target.athleteId} appears to be read-only for changes — TrainHeroic's ` +
            `seeded demo/sample athletes return ${res.status} here; writes only persist for real ` +
            `(invited) athletes.`
          : "";
      throw new Error(
        `Failed to write exercise ${result.savedWorkoutSetExerciseId} (HTTP ${res.status}).${readOnly}`,
      );
    }
    exercisesWritten += 1;
  }

  // Step 2: mark the set completed — only when logging a performed result. A prescription leaves
  // the set open, so it is skipped (the app sends no set-completion PUT when editing targets).
  if (mode === "log") {
    const allExerciseIds = exercises
      .map((e) => coerceInt(e.id))
      .filter((n): n is number => n !== null);
    const setBody = { ...buildSetCompletePayload(rawSet, allExerciseIds, true), ...extra };
    const setRes = await client.request(
      "PUT",
      `/1.0/${target.role}/savedworkoutset/${savedWorkoutSetId}${suffix}`,
      { body: setBody },
    );
    if (!setRes.ok) {
      throw new Error(
        `Failed to mark workout set ${savedWorkoutSetId} completed (HTTP ${setRes.status}).`,
      );
    }
  }

  return { savedWorkoutSetId, exercisesWritten };
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

// --- Ad-hoc / by-exercise session logging ---

/** One exercise's entered sets, keyed by the exercise id rather than a saved-set id. */
export type SessionExercise = {
  exerciseId: number;
  order?: number;
  sets: ReadonlyArray<{ param1?: number | string; param2?: number | string }>;
};

/** Result of logging a session by exercise: which sets were written, and (athlete) whether a
 * new personal session had to be created for the date. */
export type LogSessionResult = {
  date: string;
  created: boolean;
  sets: Array<{ savedWorkoutSetId: number; exercisesLogged: number }>;
};

/** A saved-set target for one requested exercise, resolved from the API. */
type ResolvedExercise = {
  exerciseId: number;
  savedWorkoutSetId: number;
  savedWorkoutSetExerciseId: number;
  sets: ReadonlyArray<{ param1?: number | string; param2?: number | string }>;
};

/**
 * Find a personal-calendar session already on the given day. The range marks these with
 * `personal_cal === true`; the addable id is the program workout's `workout_id`. Returns the
 * first one's workoutId, or null when the day has no personal session.
 */
function findPersonalSessionWorkoutId(workouts: readonly ProgramWorkout[]): number | null {
  for (const pw of workouts) {
    const rec = pw as Record<string, unknown>;
    if (rec.personal_cal === true) {
      const workoutId = coerceInt(rec.workout_id);
      if (workoutId !== null) return workoutId;
    }
  }
  return null;
}

/**
 * Map the `addExercisesToWorkout` response (an array of saved sets) to per-exercise saved ids.
 * Each set's `id` is a savedWorkoutSetId; each `savedWorkoutSetExercises[].id` is a
 * savedWorkoutSetExerciseId and `.exerciseId` is the catalog exercise id that was added.
 */
function indexAddedExercises(
  added: unknown,
): Array<{ exerciseId: number; savedWorkoutSetId: number; savedWorkoutSetExerciseId: number }> {
  const out: Array<{
    exerciseId: number;
    savedWorkoutSetId: number;
    savedWorkoutSetExerciseId: number;
  }> = [];
  const sets = Array.isArray(added) ? added : [];
  for (const s of sets) {
    if (!isRecord(s)) continue;
    const savedWorkoutSetId = coerceInt(s.id);
    if (savedWorkoutSetId === null) continue;
    const exercises = Array.isArray(s.savedWorkoutSetExercises) ? s.savedWorkoutSetExercises : [];
    for (const ex of exercises) {
      if (!isRecord(ex)) continue;
      const savedWorkoutSetExerciseId = coerceInt(ex.id);
      const exerciseId = coerceInt(ex.exerciseId ?? ex.exercise_id);
      if (savedWorkoutSetExerciseId === null || exerciseId === null) continue;
      out.push({ exerciseId, savedWorkoutSetId, savedWorkoutSetExerciseId });
    }
  }
  return out;
}

/** Flatten a day's prescribed saved sets into `{ savedWorkoutSetId, ex }` rows (both set keys). */
function eachPrescribedExercise(
  workouts: readonly ProgramWorkout[],
): Array<{ savedWorkoutSetId: number; ex: Record<string, unknown> }> {
  const rows: Array<{ savedWorkoutSetId: number; ex: Record<string, unknown> }> = [];
  for (const pw of workouts) {
    const rec = pw as Record<string, unknown>;
    const ssw = isRecord(rec.summarizedSavedWorkout) ? rec.summarizedSavedWorkout : {};
    const sw = isRecord(ssw.saved_workout) ? ssw.saved_workout : null;
    if (!sw) continue;
    const sets = [
      ...(Array.isArray(sw.workoutSets) ? sw.workoutSets : []),
      ...(Array.isArray(sw.addedWorkoutSets) ? sw.addedWorkoutSets : []),
    ];
    for (const s of sets) {
      if (!isRecord(s)) continue;
      const savedWorkoutSetId = coerceInt(s.id);
      if (savedWorkoutSetId === null) continue;
      const exercises = Array.isArray(s.workoutSetExercises) ? s.workoutSetExercises : [];
      for (const ex of exercises) if (isRecord(ex)) rows.push({ savedWorkoutSetId, ex });
    }
  }
  return rows;
}

/**
 * Locate a single prescribed exercise on the given day's workouts, returning the saved set it
 * belongs to and its saved-set-exercise id. Used by the coach path, which can only log against
 * what is already on the athlete's calendar. Returns null when the exercise is not prescribed
 * that day.
 */
function findPrescribedExercise(
  workouts: readonly ProgramWorkout[],
  exerciseId: number,
  used: ReadonlySet<number>,
): { savedWorkoutSetId: number; savedWorkoutSetExerciseId: number } | null {
  for (const { savedWorkoutSetId, ex } of eachPrescribedExercise(workouts)) {
    const sweId = coerceInt(ex.id);
    if (sweId === null || used.has(sweId)) continue;
    if (coerceInt(ex.exercise_id) === exerciseId) {
      return { savedWorkoutSetId, savedWorkoutSetExerciseId: sweId };
    }
  }
  return null;
}

/** List the prescribed exercises on a day as `id (title)` labels, for not-found errors. */
function prescribedExerciseLabels(workouts: readonly ProgramWorkout[]): string[] {
  const labels: string[] = [];
  for (const { ex } of eachPrescribedExercise(workouts)) {
    const id = coerceInt(ex.exercise_id);
    if (id === null) continue;
    const title =
      (typeof ex.exercise_title === "string" && ex.exercise_title) ||
      (typeof ex.title === "string" && ex.title) ||
      "exercise";
    labels.push(`${id} (${title})`);
  }
  return labels;
}

/** Group resolved exercises by saved set and write each set via the given log target. */
async function logResolvedExercises(
  client: TrainHeroicClient,
  target: LogTarget,
  date: string,
  resolved: readonly ResolvedExercise[],
): Promise<Array<{ savedWorkoutSetId: number; exercisesLogged: number }>> {
  const bySet = new Map<number, SetResult[]>();
  for (const r of resolved) {
    const list = bySet.get(r.savedWorkoutSetId) ?? [];
    list.push({ savedWorkoutSetExerciseId: r.savedWorkoutSetExerciseId, sets: [...r.sets] });
    bySet.set(r.savedWorkoutSetId, list);
  }
  const out: Array<{ savedWorkoutSetId: number; exercisesLogged: number }> = [];
  for (const [savedWorkoutSetId, results] of bySet) {
    const written =
      target.role === "coach"
        ? await logForAthlete(client, {
            athleteId: target.athleteId,
            date,
            savedWorkoutSetId,
            results,
          })
        : await logAthleteSet(client, { date, savedWorkoutSetId, results });
    out.push(written);
  }
  return out;
}

/**
 * Log a whole session for the logged-in athlete by exercise, with no pre-existing prescription
 * required. Reuses a personal session already on the date when one exists (the API marks these
 * `personal_cal`), otherwise creates one; then adds the exercises and logs their entered sets.
 * This is the "log whatever I just did" path — extra accessory work, a makeup lift, an off-plan
 * gym session.
 */
export async function logAdHocSession(
  client: TrainHeroicClient,
  args: { date: string; exercises: readonly SessionExercise[] },
): Promise<LogSessionResult> {
  if (args.exercises.length === 0) throw new Error("Provide at least one exercise to log.");
  const day = await fetchAthleteWorkouts(client, args.date, args.date);
  const existing = findPersonalSessionWorkoutId(day);
  const created = existing === null;
  const workoutId = existing ?? (await createPersonalWorkout(client, args.date)).workoutId;

  const withOrder = args.exercises.map((e, i) => ({ ...e, order: e.order ?? i + 1 }));
  const added = await addExercisesToWorkout(
    client,
    workoutId,
    withOrder.map((e) => ({ exerciseId: e.exerciseId, order: e.order })),
  );
  const index = indexAddedExercises(added);

  const consumed = new Set<number>();
  const resolved: ResolvedExercise[] = withOrder.map((e) => {
    const hit = index.find(
      (m) => m.exerciseId === e.exerciseId && !consumed.has(m.savedWorkoutSetExerciseId),
    );
    if (!hit) {
      throw new Error(
        `Could not place exercise ${e.exerciseId} into the session after adding it. ` +
          "The add-exercises response did not return a saved set for it.",
      );
    }
    consumed.add(hit.savedWorkoutSetExerciseId);
    return {
      exerciseId: e.exerciseId,
      savedWorkoutSetId: hit.savedWorkoutSetId,
      savedWorkoutSetExerciseId: hit.savedWorkoutSetExerciseId,
      sets: e.sets,
    };
  });

  const sets = await logResolvedExercises(client, { role: "athlete" }, args.date, resolved);
  return { date: args.date, created, sets };
}

/**
 * Coach "log a session for a roster athlete" by exercise. The API offers no way to put an
 * off-plan session on another user's calendar (the personal-calendar endpoints are self-scoped),
 * so this logs against the session the athlete already has on that date: each requested exercise
 * is resolved to a prescribed saved set and its results are written via the coach "Log for
 * Athlete" surface. Throws a readable error naming the prescribed exercises when one is missing.
 */
export async function logSessionForAthlete(
  client: TrainHeroicClient,
  args: { athleteId: number; date: string; exercises: readonly SessionExercise[] },
): Promise<LogSessionResult> {
  if (args.exercises.length === 0) throw new Error("Provide at least one exercise to log.");
  const day = await fetchCoachAthleteWorkouts(client, args.athleteId, args.date, args.date);

  const used = new Set<number>();
  const resolved: ResolvedExercise[] = args.exercises.map((e) => {
    const hit = findPrescribedExercise(day, e.exerciseId, used);
    if (!hit) {
      const labels = prescribedExerciseLabels(day);
      const present =
        labels.length > 0
          ? `Prescribed on ${args.date}: ${labels.join(", ")}.`
          : `Nothing is prescribed for athlete ${args.athleteId} on ${args.date}.`;
      throw new Error(
        `Exercise ${e.exerciseId} is not on athlete ${args.athleteId}'s calendar for ${args.date}, ` +
          `so there is no set to log it against. ${present} A coach can only log against an existing ` +
          "session; build/publish a session for the athlete first if it is missing.",
      );
    }
    used.add(hit.savedWorkoutSetExerciseId);
    return { exerciseId: e.exerciseId, ...hit, sets: e.sets };
  });

  const sets = await logResolvedExercises(
    client,
    { role: "coach", athleteId: args.athleteId },
    args.date,
    resolved,
  );
  return { date: args.date, created: false, sets };
}

/** Flatten `/v5/exercises/{id}/history` into PRs + a session time-series. */
export function presentExerciseHistory(detail: ExerciseHistoryDetail): PresentedExerciseHistory {
  const liftPRs = (detail.liftPRs ?? []).map((p) => ({
    description: p.description ?? null,
    reps: p.reps ?? null,
    weight: p.weight ?? null,
    units: p.units ?? null,
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
