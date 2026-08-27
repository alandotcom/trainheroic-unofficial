// Per-exercise note write. Split from athlete-workout-note.ts because this PUT targets
// `/1.0/athlete/savedworkoutsetexercise/{id}` (the slot), not the session. Runtime-agnostic.

import type { AthleteExerciseNoteOutput } from "@trainheroic-unofficial/dto";
import type { TrainHeroicClient } from "./client";
import { coerceInt, isRecord } from "./exercise-util";

/**
 * PUT /1.0/athlete/savedworkoutsetexercise/{id} — set the athlete's per-exercise note (the
 * "Add exercise note" box on the exercise screen). A notes-only body leaves logged reps/weight
 * untouched. Empty `notes` clears the note. GET on that path 405s; the range read and exercise
 * history both echo the stored string. Coach-visible.
 */
export async function setAthleteExerciseNote(
  client: TrainHeroicClient,
  args: { savedWorkoutSetExerciseId: number | string; notes: string },
): Promise<AthleteExerciseNoteOutput> {
  const savedWorkoutSetExerciseId = coerceInt(args.savedWorkoutSetExerciseId);
  if (savedWorkoutSetExerciseId === null) {
    throw new Error(`Invalid savedWorkoutSetExerciseId ${String(args.savedWorkoutSetExerciseId)}.`);
  }
  const res = await client.request<unknown>(
    "PUT",
    `/1.0/athlete/savedworkoutsetexercise/${savedWorkoutSetExerciseId}`,
    { body: { id: savedWorkoutSetExerciseId, notes: args.notes } },
  );
  if (!res.ok) {
    throw new Error(`Set exercise note failed (HTTP ${res.status}).`);
  }
  const data = isRecord(res.data) ? res.data : {};
  return {
    savedWorkoutSetExerciseId,
    notes: typeof data.notes === "string" ? data.notes : args.notes,
  };
}
