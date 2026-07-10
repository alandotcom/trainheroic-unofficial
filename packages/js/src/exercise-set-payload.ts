import { coerceInt, MAX_PARAM_SLOTS } from "./exercise-util";

export type SetWriteMode = "log" | "prescribe";

export type ExerciseSetInput = {
  param1?: number | string;
  param2?: number | string;
  slot?: number;
};

export type ExerciseSetPayload = Record<string, unknown> & {
  id: number;
  saved_workout_set_id: number;
  workout_set_exercise_id: number;
  completed: 0 | 1;
};

function slotData(exercise: Record<string, unknown> | undefined, key: string): string {
  const value = exercise?.[key];
  return value === undefined || value === null ? "" : String(value);
}

function slotIsActive(
  exercise: Record<string, unknown> | undefined,
  slot: number,
  targeted = false,
): boolean {
  return (
    targeted ||
    slotData(exercise, `param_1_data_${slot}`) !== "" ||
    slotData(exercise, `param_2_data_${slot}`) !== "" ||
    coerceInt(exercise?.[`param_${slot}_made`]) === 1
  );
}

/** True when an existing saved-copy exercise has at least one active slot and all are performed. */
export function exerciseIsFullyLogged(exercise: Record<string, unknown>): boolean {
  let anyActive = false;
  for (let slot = 1; slot <= MAX_PARAM_SLOTS; slot += 1) {
    if (!slotIsActive(exercise, slot)) continue;
    anyActive = true;
    if (coerceInt(exercise[`param_${slot}_made`]) !== 1) return false;
  }
  return anyActive;
}

/**
 * Build the typed body for `PUT /1.0/{role}/savedworkoutsetexercise/{id}`.
 *
 * A log marks only slots carrying reps as performed. The exercise completes only when every active
 * slot is performed; active slots are prescribed values, prior performed values, or slots targeted
 * by this write. Untargeted performed slots carry over, while untouched prescription values are
 * blanked so TrainHeroic cannot fabricate performed results from them. A prescription replaces the
 * full payload and never marks slots or the exercise complete.
 */
export function buildExerciseSetPayload(
  savedWorkoutSetExerciseId: number,
  savedWorkoutSetId: number,
  workoutSetExerciseId: number,
  results: readonly ExerciseSetInput[],
  mode: SetWriteMode,
  existing?: Record<string, unknown>,
): ExerciseSetPayload {
  if (results.length > MAX_PARAM_SLOTS) {
    throw new Error(
      `At most ${MAX_PARAM_SLOTS} sets are supported per exercise; got ${results.length}.`,
    );
  }

  const bySlot = new Map<number, ExerciseSetInput>();
  results.forEach((set, index) => {
    const slot = set.slot ?? index + 1;
    if (slot < 1 || slot > MAX_PARAM_SLOTS) {
      throw new Error(`Set slot ${slot} is out of range; slots are 1–${MAX_PARAM_SLOTS}.`);
    }
    if (bySlot.has(slot)) {
      throw new Error(`Two sets target slot ${slot}; each slot can be written once.`);
    }
    bySlot.set(slot, set);
  });

  const logging = mode === "log";
  const body: ExerciseSetPayload = {
    id: savedWorkoutSetExerciseId,
    saved_workout_set_id: savedWorkoutSetId,
    workout_set_exercise_id: workoutSetExerciseId,
    completed: 0,
  };
  let anyMade = false;
  let allActiveSlotsMade = true;

  for (let slot = 1; slot <= MAX_PARAM_SLOTS; slot += 1) {
    const target = bySlot.get(slot);
    let param1 = "";
    let param2 = "";
    let made = 0;

    if (target) {
      param1 = target.param1 === undefined ? "" : String(target.param1);
      param2 = target.param2 === undefined ? "" : String(target.param2);
      made = logging && param1 !== "" ? 1 : 0;
    } else if (logging && coerceInt(existing?.[`param_${slot}_made`]) === 1) {
      param1 = slotData(existing, `param_1_data_${slot}`);
      param2 = slotData(existing, `param_2_data_${slot}`);
      made = 1;
    }

    anyMade ||= made === 1;
    if (slotIsActive(existing, slot, target !== undefined) && made !== 1) {
      allActiveSlotsMade = false;
    }
    body[`param_${slot}_made`] = made;
    body[`param_1_data_${slot}`] = param1;
    body[`param_2_data_${slot}`] = param2;
  }

  body.completed = logging && anyMade && allActiveSlotsMade ? 1 : 0;
  return body;
}
