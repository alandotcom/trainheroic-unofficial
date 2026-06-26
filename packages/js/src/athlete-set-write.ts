// The athlete set-logging write path, split out of athlete.ts (which keeps the reads and
// presenters). Records entered set results against a saved workout set (log / prescribe), swaps a
// prescribed exercise, creates personal sessions, and logs a whole session by exercise. It reaches
// the same TrainHeroic hosts as the reads; the day's range is fetched via athlete.ts's read
// helpers to resolve the ids each write needs. Runtime-agnostic: no `node:*`, so it runs on workerd.

import { coerceInt, isRecord, MAX_PARAM_SLOTS, str } from "./exercise-util";
import { fetchAthleteWorkouts, fetchCoachAthleteWorkouts } from "./athlete";
import type { TrainHeroicClient } from "./client";
import type { ProgramWorkout } from "@trainheroic-unofficial/dto";

/**
 * One set of entered values for a single exercise within a saved workout set.
 * `param1` and `param2` correspond to the exercise's first and second parameter types
 * (e.g. reps and weight). Optional `slot` is the 1-based prescribed position this set fills;
 * omit it and the sets fill positions sequentially from the first. At most 10 sets are supported.
 */
export type SetResult = {
  savedWorkoutSetExerciseId: number;
  sets: Array<{ param1?: number | string; param2?: number | string; slot?: number }>;
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
      slot?: number | undefined;
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
        const set: { param1?: number | string; param2?: number | string; slot?: number } = {};
        if (s.param1 !== undefined) set.param1 = s.param1;
        if (s.param2 !== undefined) set.param2 = s.param2;
        if (s.slot !== undefined) set.slot = s.slot;
        return set;
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
 *     and the exercise `completed` flag is 1 when any set has logged data.
 *   - `"prescribe"`: the values are prescribed targets, written with every `param_N_made` and
 *     `completed` left at 0 so the set is not marked done. This matches what the app sends when a
 *     coach edits an athlete's prescribed reps/weight.
 *
 * Each set fills a 1-based slot: its explicit `slot`, or its sequential position in `results`
 * when `slot` is omitted. A `log` carrying the live exercise record in `existing` keeps the slots
 * it does not write that were ALREADY performed (`param_N_made === 1`), so logging a second part of
 * a set does not wipe the earlier-logged sets. A slot holding only un-logged prescription pre-fill
 * (`param_N_made === 0`) is left blank rather than carried over: marking the set completed makes
 * the server flag every data-bearing slot performed, so preserving that pre-fill would fabricate
 * sets the athlete never did. The prescription is unaffected (it lives in the separate `workout`
 * copy, not this saved copy). A `prescribe` ignores `existing` and replaces the whole prescription.
 *
 * Only `savedWorkoutSetExerciseId`, `savedWorkoutSetId`, and `workoutSetExerciseId` are
 * required from the live exercise record; everything else is derived from `results` and the
 * preserved slots of `existing`.
 *
 * Exported for unit testing — callers should use `logAthleteSet` / `prescribeForAthlete` instead.
 */
export function buildExerciseSetPayload(
  savedWorkoutSetExerciseId: number,
  savedWorkoutSetId: number,
  workoutSetExerciseId: number,
  results: readonly { param1?: number | string; param2?: number | string; slot?: number }[],
  mode: SetWriteMode,
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  if (results.length > MAX_PARAM_SLOTS) {
    throw new Error(
      `At most ${MAX_PARAM_SLOTS} sets are supported per exercise; got ${results.length}.`,
    );
  }
  // Resolve each entered set to a 1-based slot — an explicit `slot`, else the next sequential
  // position — rejecting an out-of-range or duplicated slot so two results never collide.
  const bySlot = new Map<number, { param1?: number | string; param2?: number | string }>();
  results.forEach((set, i) => {
    const slot = set.slot ?? i + 1;
    if (slot < 1 || slot > MAX_PARAM_SLOTS) {
      throw new Error(`Set slot ${slot} is out of range; slots are 1–${MAX_PARAM_SLOTS}.`);
    }
    if (bySlot.has(slot)) {
      throw new Error(`Two sets target slot ${slot}; each slot can be written once.`);
    }
    bySlot.set(slot, set);
  });

  const performed = mode === "log";
  // Only a log carries over a slot it does not write, and only when that slot was already
  // performed — so a second partial log keeps the earlier-logged sets without fabricating a result
  // from un-logged prescription pre-fill. A prescribe replaces the whole prescription, and with no
  // live record there is nothing to carry over.
  const carryOver = performed && existing !== undefined;
  const body: Record<string, unknown> = {
    id: savedWorkoutSetExerciseId,
    saved_workout_set_id: savedWorkoutSetId,
    workout_set_exercise_id: workoutSetExerciseId,
  };
  let anyMade = false;
  for (let i = 1; i <= MAX_PARAM_SLOTS; i += 1) {
    const target = bySlot.get(i);
    let p1: string;
    let p2: string;
    let made: number;
    if (target) {
      p1 = target.param1 !== undefined ? String(target.param1) : "";
      p2 = target.param2 !== undefined ? String(target.param2) : "";
      made = performed && (p1 !== "" || p2 !== "") ? 1 : 0;
    } else if (carryOver && coerceInt(existing?.[`param_${i}_made`]) === 1) {
      p1 = existingSlotData(existing, `param_1_data_${i}`);
      p2 = existingSlotData(existing, `param_2_data_${i}`);
      made = 1;
    } else {
      p1 = "";
      p2 = "";
      made = 0;
    }
    if (made === 1) anyMade = true;
    body[`param_${i}_made`] = made;
    body[`param_1_data_${i}`] = p1;
    body[`param_2_data_${i}`] = p2;
  }
  body.completed = performed && anyMade ? 1 : 0;
  return body;
}

/** Read a saved-copy slot value (`param_1_data_N` / `param_2_data_N`) as the string the body uses. */
function existingSlotData(existing: Record<string, unknown> | undefined, key: string): string {
  const v = existing?.[key];
  return v === undefined || v === null ? "" : String(v);
}

/** True when a saved-copy exercise already carries a performed slot (any `param_N_made` === 1). */
function exerciseHasLoggedData(ex: Record<string, unknown>): boolean {
  for (let i = 1; i <= MAX_PARAM_SLOTS; i += 1) {
    if (coerceInt(ex[`param_${i}_made`]) === 1) return true;
  }
  return false;
}

/** True when a result carries at least one non-empty param value (so it produces a performed slot). */
function resultHasData(result: SetResult): boolean {
  return result.sets.some(
    (s) =>
      (s.param1 !== undefined && String(s.param1) !== "") ||
      (s.param2 !== undefined && String(s.param2) !== ""),
  );
}

/**
 * Whether every exercise in a saved workout set now has logged data — either written with data in
 * this call (`loggedIds`) or already carrying a performed slot. Gates the set-completion PUT: a
 * superset/circuit stays open until the last exercise is logged, so completing it on a partial log
 * does not flip its still-empty siblings to "done". An exercise written with only empty values does
 * not count (it would not be marked performed), so an all-empty log never completes the set.
 */
function isSetFullyLogged(
  exercises: readonly Record<string, unknown>[],
  loggedIds: ReadonlySet<number>,
): boolean {
  return exercises.every((ex) => {
    const id = coerceInt(ex.id);
    return (id !== null && loggedIds.has(id)) || exerciseHasLoggedData(ex);
  });
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
): Promise<{ savedWorkoutSetId: number; exercisesLogged: number; setCompleted: boolean }> {
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
  return {
    savedWorkoutSetId: r.savedWorkoutSetId,
    exercisesLogged: r.exercisesWritten,
    setCompleted: r.setCompleted,
  };
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
): Promise<{ savedWorkoutSetId: number; exercisesLogged: number; setCompleted: boolean }> {
  const workouts = await fetchCoachAthleteWorkouts(client, args.athleteId, args.date, args.date);
  const r = await writeSetResults(
    client,
    { role: "coach", athleteId: args.athleteId },
    workouts,
    args.savedWorkoutSetId,
    args.results,
    "log",
  );
  return {
    savedWorkoutSetId: r.savedWorkoutSetId,
    exercisesLogged: r.exercisesWritten,
    setCompleted: r.setCompleted,
  };
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
): Promise<{ savedWorkoutSetId: number; exercisesWritten: number; setCompleted: boolean }> {
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
        `savedWorkoutSetExercise ${result.savedWorkoutSetExerciseId} is missing its ` +
          `workout_set_exercise_id (the prescription-template pointer the write needs). This is the ` +
          `savedWorkoutSetExerciseId, not an exercise_id — re-read the ids from athlete_saved_workouts.`,
      );
    }
    const body = {
      ...buildExerciseSetPayload(
        result.savedWorkoutSetExerciseId,
        savedWorkoutSetId,
        workoutSetExerciseId,
        result.sets,
        mode,
        ex,
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

  // Step 2: mark the set completed — only when logging a performed result, and only when every
  // exercise in the set now has logged data (see isSetFullyLogged). A prescription leaves the set
  // open, so it is skipped.
  let setCompleted = false;
  if (mode === "log") {
    const loggedIds = new Set(
      results.filter(resultHasData).map((r) => r.savedWorkoutSetExerciseId),
    );
    if (isSetFullyLogged(exercises, loggedIds)) {
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
      setCompleted = true;
    }
  }

  return { savedWorkoutSetId, exercisesWritten, setCompleted };
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
    // Keep the per-set shape to the two fields LogSessionResult documents; block completion is a
    // by-set concern that the by-exercise session log does not surface.
    out.push({
      savedWorkoutSetId: written.savedWorkoutSetId,
      exercisesLogged: written.exercisesLogged,
    });
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
