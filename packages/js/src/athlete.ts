// The athlete-facing SDK surface. These functions reach the same TrainHeroic hosts as the
// coach SDK (default `coach` base) but read the logged-in user's own training: scheduled and
// completed workouts, per-exercise history, PRs, and working maxes. Runtime-agnostic: no
// `node:*`, so this runs unchanged on workerd.

import {
  coerceInt,
  coerceNum,
  exerciseTitle,
  exerciseUnits,
  isPersonalSession,
  isRecord,
  mapPool,
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
  ExportExercise,
  ExportSetParam,
  ExportSetSide,
  PersonalRecord,
  PresentedExerciseHistory,
  ProgramWorkout,
  RosterActivityRow,
  WorkoutHistoryExport,
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

/** Add `days` to a `YYYY-MM-DD` date (UTC), returning `YYYY-MM-DD`. */
function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Split an inclusive `[start, end]` range into consecutive non-overlapping windows of `windowDays`. */
export function dateWindows(
  startDate: string,
  endDate: string,
  windowDays: number,
): Array<{ start: string; end: string }> {
  const size = Math.max(1, Math.floor(windowDays));
  const windows: Array<{ start: string; end: string }> = [];
  // `cursor` advances by `size` days each step and the loop stops at `endDate`, so a start-after-end
  // range yields no windows and the loop always terminates.
  let cursor = startDate;
  while (cursor <= endDate) {
    const winEnd = shiftDate(cursor, size - 1);
    const clamped = winEnd > endDate ? endDate : winEnd;
    windows.push({ start: cursor, end: clamped });
    cursor = shiftDate(clamped, 1);
  }
  return windows;
}

/**
 * Merge windowed pages of workouts into one list: deduped by workout id (a session sitting on a
 * window boundary must not double up, first occurrence wins), then sorted oldest-first by date so
 * the order is stable regardless of window seams. Id-less rows are kept and appended.
 */
export function mergeWorkoutsById(pages: readonly ProgramWorkout[][]): ProgramWorkout[] {
  const byId = new Map<number, ProgramWorkout>();
  const noId: ProgramWorkout[] = [];
  for (const pw of pages.flat()) {
    const id = coerceInt((pw as Record<string, unknown>).id);
    if (id === null) noId.push(pw);
    else if (!byId.has(id)) byId.set(id, pw);
  }
  return [...byId.values(), ...noId].sort((a, b) => {
    const da = str((a as Record<string, unknown>).date) ?? "";
    const db = str((b as Record<string, unknown>).date) ?? "";
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

/**
 * Fetch an athlete's workouts across a long range by splitting it into windows and fetching them
 * with bounded concurrency, then merging (deduped by workout id, sorted oldest-first). The
 * `programworkout/range` endpoint 504s on a multi-year span, so a full-history export must chunk.
 * `windowDays` defaults to 180; `onProgress(done, total)` reports completed windows for a progress
 * indicator. A range that fits one window delegates to the plain fetch (API order preserved).
 */
export async function fetchAthleteWorkoutsChunked(
  client: TrainHeroicClient,
  startDate: string,
  endDate: string,
  opts: {
    windowDays?: number;
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<ProgramWorkout[]> {
  const windows = dateWindows(startDate, endDate, opts.windowDays ?? 180);
  if (windows.length <= 1) return fetchAthleteWorkouts(client, startDate, endDate);

  let done = 0;
  const total = windows.length;
  const pages = await mapPool(windows, opts.concurrency ?? 4, async (w) => {
    const page = await fetchAthleteWorkouts(client, w.start, w.end);
    done += 1;
    opts.onProgress?.(done, total);
    return page;
  });

  return mergeWorkoutsById(pages);
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

// Both presented views project from one merge. `mergeAthleteWorkout` owns every TrainHeroic-
// specific rule: a slot counts as performed only when `param_i_made === 1` (the saved copy
// pre-fills the prescription values, so data-presence alone lies), a saved exercise's
// `workout_set_exercise_id` points back at the prescription exercise's `id`, and athlete-added
// work with no prescription is appended as its own block. The readable string view and the
// structured export differ only in each set's leaf shape, so the merge lives here once and each
// `present*` function is a thin projection.

/** One set's two positional slots, kept raw so the string view can join them verbatim
 * (`"5 @ 225"`, `"AMRAP"`) while the export re-parses them into numbers. `null` is an empty slot. */
type SlotValue = { p1: unknown; p2: unknown };

/**
 * Slot-indexed values for one exercise. With `requireMade`, only slots the athlete logged
 * (`param_i_made === 1`) — the performed reader; otherwise every slot carrying data — the
 * prescription reader. Values stay raw; the projectors format or parse them.
 */
function slotValues(ex: Record<string, unknown>, requireMade: boolean): Map<number, SlotValue> {
  const map = new Map<number, SlotValue>();
  for (let i = 1; i <= MAX_PARAM_SLOTS; i += 1) {
    if (requireMade && coerceInt(ex[`param_${i}_made`]) !== 1) continue;
    const p1 = ex[`param_1_data_${i}`];
    const p2 = ex[`param_2_data_${i}`];
    if (!nonEmpty(p1) && !nonEmpty(p2)) continue;
    map.set(i, { p1: nonEmpty(p1) ? p1 : null, p2: nonEmpty(p2) ? p2 : null });
  }
  return map;
}

/** The joined display for a slot, kept verbatim (`"5 @ 225"`, `"AMRAP"`, `"@ 225"`). */
function fmtSlot(slot: SlotValue): string {
  const has1 = slot.p1 !== null;
  const has2 = slot.p2 !== null;
  if (has1 && has2) return `${slot.p1} @ ${slot.p2}`;
  if (has1) return String(slot.p1);
  if (has2) return `@ ${slot.p2}`;
  return "";
}

/** Every slot carrying data, joined for display (the prescription reader): `["5 @ 225", "AMRAP"]`. */
function prescribedStrings(ex: Record<string, unknown>): string[] {
  return [...slotValues(ex, false).values()].map(fmtSlot);
}

/** The slots the athlete logged (`param_i_made === 1`), joined for display (the performed reader). */
function performedStrings(ex: Record<string, unknown>): string[] {
  return [...slotValues(ex, true).values()].map(fmtSlot);
}

// --- Canonical merged form (private; the source both presenters project from) ---

type MergedSet = { set: number; prescribed: SlotValue | null; performed: SlotValue | null };
type MergedExerciseMeta = {
  exerciseId: number | null;
  title: string;
  instruction: string | null;
  units: Array<string | null>;
};
type MergedExercise = MergedExerciseMeta & { sets: MergedSet[] };
type MergedBlock = {
  order: number;
  title: string | null;
  instruction: string | null;
  isTest: boolean;
  exercises: MergedExercise[];
};
type MergedWorkout = {
  id: number | null;
  date: string;
  title: string;
  program: string | null;
  team: string | null;
  instruction: string | null;
  logged: boolean;
  personal: boolean;
  blocks: MergedBlock[];
};

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
 * Map each prescription exercise id to the slot-indexed values the athlete logged against it. In
 * the saved copy `workout_set_exercise_id` points back at the prescription exercise's `id`, and the
 * entered values live in the same `param_N_data` slots as a prescription.
 */
function performedSlotsByExerciseId(
  sets: Array<{ exercises: Record<string, unknown>[] }>,
): Map<number, Map<number, SlotValue>> {
  const map = new Map<number, Map<number, SlotValue>>();
  for (const { exercises } of sets) {
    for (const ex of exercises) {
      const id = coerceInt(ex.workout_set_exercise_id);
      if (id === null) continue;
      const slots = slotValues(ex, true);
      if (slots.size > 0) map.set(id, slots);
    }
  }
  return map;
}

/** Align an exercise's prescribed slots with the slots the athlete logged, per set index. */
function mergeExercise(
  prescribed: Map<number, SlotValue>,
  performed: Map<number, SlotValue>,
  meta: MergedExerciseMeta,
): MergedExercise {
  const indices = [...new Set([...prescribed.keys(), ...performed.keys()])].sort((a, b) => a - b);
  return {
    ...meta,
    sets: indices.map((i) => ({
      set: i,
      prescribed: prescribed.get(i) ?? null,
      performed: performed.get(i) ?? null,
    })),
  };
}

/** A prescription block, each exercise aligned with the slots the athlete logged against it. */
function mergePrescriptionBlock(
  set: Record<string, unknown>,
  performedById: Map<number, Map<number, SlotValue>>,
): MergedBlock {
  const exercises = Array.isArray(set.workoutSetExercises) ? set.workoutSetExercises : [];
  return {
    order: coerceInt(set.order) ?? 0,
    title: str(set.title),
    instruction: str(set.instruction),
    isTest: coerceInt(set.is_test) === 1,
    exercises: exercises.filter(isRecord).map((ex) => {
      const id = coerceInt(ex.id);
      const performed = (id !== null ? performedById.get(id) : undefined) ?? new Map();
      return mergeExercise(slotValues(ex, false), performed, {
        exerciseId: coerceInt(ex.exercise_id),
        title: typeof ex.title === "string" ? ex.title : "",
        instruction: str(ex.instruction),
        units: exerciseUnits(ex.param_1_type, ex.param_2_type),
      });
    }),
  };
}

/** A logged block straight from the saved copy (athlete-added or personal work; no prescription). */
function mergeSavedBlock(
  set: Record<string, unknown>,
  exercises: Record<string, unknown>[],
): MergedBlock {
  return {
    order: coerceInt(set.order) ?? 0,
    title: str(set.title),
    instruction: str(set.instruction),
    isTest: coerceInt(set.is_test) === 1,
    exercises: exercises.map((ex) =>
      mergeExercise(new Map(), slotValues(ex, true), {
        exerciseId: coerceInt(ex.exercise_id),
        title: typeof ex.exercise_title === "string" ? ex.exercise_title : "",
        instruction: str(ex.instruction),
        units: exerciseUnits(ex.param_1_type, ex.param_2_type),
      }),
    ),
  };
}

/**
 * Flatten one `/3.0/athlete/programworkout/range` item into the canonical merged form, joining the
 * prescription (`summarizedSavedWorkout.workout`) with what the athlete logged
 * (`summarizedSavedWorkout.saved_workout`). Prescription blocks are enriched with logged slots;
 * athlete-added / personal work with no prescription is appended as its own block.
 */
function mergeAthleteWorkout(raw: ProgramWorkout): MergedWorkout {
  const rec = raw as Record<string, unknown>;
  const ssw = isRecord(rec.summarizedSavedWorkout) ? rec.summarizedSavedWorkout : {};
  const workout = isRecord(ssw.workout) ? ssw.workout : {};
  const saved = isRecord(ssw.saved_workout) ? ssw.saved_workout : {};
  const prescriptionSets = (Array.isArray(workout.workoutSets) ? workout.workoutSets : []).filter(
    isRecord,
  );

  const logged = savedSets(saved);
  const performedById = performedSlotsByExerciseId(logged);

  // Prescription blocks, each exercise enriched with what the athlete actually logged.
  const blocks = prescriptionSets
    .map((s) => mergePrescriptionBlock(s, performedById))
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
      if (slotValues(ex, true).size === 0) return false;
      const id = coerceInt(ex.workout_set_exercise_id);
      return id === null || !prescribedIds.has(id);
    });
    if (extra.length > 0) blocks.push(mergeSavedBlock(set, extra));
  }

  return {
    id: coerceInt(rec.id),
    date: str(rec.date) ?? "",
    title: str(rec.workout_title) ?? "",
    program: str(rec.program_title),
    team: str(rec.team_title),
    instruction: str(workout.instruction),
    logged: blocks.some((b) => b.exercises.some((e) => e.sets.some((s) => s.performed !== null))),
    personal: isPersonalSession(rec),
    blocks,
  };
}

// --- Readable string view ---

/** The per-set displays for one side (prescribed or performed), in slot order. */
function sideStrings(sets: MergedSet[], pick: (s: MergedSet) => SlotValue | null): string[] {
  const out: string[] = [];
  for (const s of sets) {
    const slot = pick(s);
    if (slot) out.push(fmtSlot(slot));
  }
  return out;
}

function toStringExercise(ex: MergedExercise): AthleteWorkoutExercise {
  return {
    exerciseId: ex.exerciseId,
    title: ex.title,
    instruction: ex.instruction,
    units: ex.units,
    prescribed: sideStrings(ex.sets, (s) => s.prescribed),
    performed: sideStrings(ex.sets, (s) => s.performed),
  };
}

function toStringBlock(b: MergedBlock): AthleteWorkoutBlock {
  return {
    order: b.order,
    title: b.title,
    instruction: b.instruction,
    isTest: b.isTest,
    exercises: b.exercises.map(toStringExercise),
  };
}

/**
 * Flatten one range item into a readable workout: each exercise carries its `prescribed` and
 * `performed` sets as joined `"5 @ 225"` strings; athlete-added/personal work that has no
 * prescription is appended as its own blocks. No `raw` is needed to see logged results.
 */
export function presentAthleteWorkout(raw: ProgramWorkout): AthleteWorkoutView {
  const w = mergeAthleteWorkout(raw);
  return {
    id: w.id,
    date: w.date,
    title: w.title,
    program: w.program,
    team: w.team,
    instruction: w.instruction,
    logged: w.logged,
    personal: w.personal,
    blocks: w.blocks.map(toStringBlock),
  };
}

export function presentAthleteWorkouts(list: readonly ProgramWorkout[]): AthleteWorkoutView[] {
  return list.map(presentAthleteWorkout);
}

// --- Structured export view ---
//
// The same canonical merge as the string view, but keeping each set's numeric values (reps/weight
// broken out by unit) instead of the joined `"5 @ 225"` string, so it serializes cleanly to CSV
// and JSON. The export drops the per-level `instruction` fields the string view carries (they hold
// no numeric value). Both views come from `mergeAthleteWorkout`, so the merge has a single home.

/** Parse a raw slot cell into an export value: a number when numeric, else the trimmed string,
 * else null. */
function paramValue(v: unknown): number | string | null {
  const n = coerceNum(v);
  if (n !== null) return n;
  return nonEmpty(v) ? String(v).trim() : null;
}

/**
 * Build one prescribed/performed side of a set, pulling reps/weight out of the two slots by unit.
 * The range endpoint reports weight under the fixed `lb` param-type code regardless of the
 * athlete's metric preference, so `lb` is the only weight unit that flows here.
 */
function exportSide(slot: SlotValue, units: Array<string | null>): ExportSetSide {
  const params: ExportSetParam[] = [
    { unit: units[0] ?? null, value: paramValue(slot.p1) },
    { unit: units[1] ?? null, value: paramValue(slot.p2) },
  ];
  const repsParam = params.find((p) => p.unit === "reps");
  const weightParam = params.find((p) => p.unit === "lb");
  return {
    reps: repsParam?.value ?? null,
    weight: weightParam?.value ?? null,
    weightUnit: weightParam?.unit ?? null,
    params,
    display: fmtSlot(slot),
  };
}

function toExportExercise(ex: MergedExercise): ExportExercise {
  return {
    exerciseId: ex.exerciseId,
    title: ex.title,
    units: ex.units,
    sets: ex.sets.map((s) => ({
      set: s.set,
      prescribed: s.prescribed ? exportSide(s.prescribed, ex.units) : null,
      performed: s.performed ? exportSide(s.performed, ex.units) : null,
    })),
  };
}

/** Flatten one workout into the structured export shape (numeric sets), from the same merge as
 * {@link presentAthleteWorkout}. */
export function presentAthleteWorkoutExport(raw: ProgramWorkout): WorkoutHistoryExport {
  const w = mergeAthleteWorkout(raw);
  return {
    id: w.id,
    date: w.date,
    title: w.title,
    program: w.program,
    team: w.team,
    logged: w.logged,
    personal: w.personal,
    blocks: w.blocks.map((b) => ({
      order: b.order,
      title: b.title,
      isTest: b.isTest,
      exercises: b.exercises.map(toExportExercise),
    })),
  };
}

export function presentAthleteWorkoutsExport(
  list: readonly ProgramWorkout[],
): WorkoutHistoryExport[] {
  return list.map(presentAthleteWorkoutExport);
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
            title: exerciseTitle(ex),
            units: exerciseUnits(ex.param_1_type, ex.param_2_type),
            prescribed: prescribedStrings(ex),
            performed: performedStrings(ex),
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
 * Narrow a workout list for the common "what did I actually do" reads. `loggedOnly` keeps only
 * workouts the athlete logged a set on (the reliable signal, not the API's completion flag).
 * `limit` keeps the most recent N by date (newest first). Both are pure post-filters; the raw API
 * path is left untouched. Generic over the presented (`AthleteWorkoutView`) and exported
 * (`WorkoutHistoryExport`) shapes, which both carry `date` and `logged`, so one rule serves both.
 */
export function selectWorkouts<T extends { date: string; logged: boolean }>(
  list: readonly T[],
  opts: { loggedOnly?: boolean; limit?: number } = {},
): T[] {
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
      personal: w.personal,
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
