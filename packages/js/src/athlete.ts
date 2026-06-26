// The athlete-facing SDK surface. These functions reach the same TrainHeroic hosts as the
// coach SDK (default `coach` base) but read the logged-in user's own training: scheduled and
// completed workouts, per-exercise history, PRs, and working maxes. Runtime-agnostic: no
// `node:*`, so this runs unchanged on workerd.

import {
  coerceInt,
  exerciseUnits,
  isRecord,
  MAX_PARAM_SLOTS,
  rankSearch,
  str,
} from "./exercise-util";
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
  for (let i = 1; i <= MAX_PARAM_SLOTS; i += 1) {
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
  for (let i = 1; i <= MAX_PARAM_SLOTS; i += 1) {
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
 * workouts, so a caller wanting one program's session narrows it here. Match by `programId`/`teamId`
 * (exact, on the raw `program_id`/`team_id`) or by `programTitle` (case-insensitive substring on the
 * `program_title`/`team_title`) — the title match lets a caller target a program by name without
 * first resolving its id. Any one match keeps the workout; with no filter the list is unchanged.
 */
export function selectWorkoutsByProgram(
  list: readonly ProgramWorkout[],
  filter: { programId?: number; teamId?: number; programTitle?: string },
): ProgramWorkout[] {
  const { programId, teamId, programTitle } = filter;
  const needle = programTitle?.trim().toLowerCase();
  if (programId === undefined && teamId === undefined && !needle) return [...list];
  return list.filter((pw) => {
    const rec = pw as Record<string, unknown>;
    if (programId !== undefined && coerceInt(rec.program_id) === programId) return true;
    if (teamId !== undefined && coerceInt(rec.team_id) === teamId) return true;
    if (needle) {
      const title = `${str(rec.program_title) ?? ""} ${str(rec.team_title) ?? ""}`.toLowerCase();
      if (title.includes(needle)) return true;
    }
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
