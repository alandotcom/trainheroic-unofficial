// Session-note write for a saved workout. Split out of athlete-set-write.ts because this PUT
// targets `/1.0/athlete/savedworkout/{id}` (the session object), not a set. Runtime-agnostic:
// no `node:*`, so this runs on workerd.

import type { AthleteWorkoutNoteOutput } from "@trainheroic-unofficial/dto";
import { programWorkoutOnDate } from "./athlete";
import type { TrainHeroicClient } from "./client";
import { coerceInt, isRecord, savedWorkoutOf } from "./exercise-util";
import { definedProps } from "./util";

/**
 * PUT /1.0/athlete/savedworkout/{id} — set the athlete's session note (the free-text box on the
 * workout screen) and/or session RPE. The date + programWorkoutId (`athlete_workouts` `id`) locate
 * the saved workout; GET on that path 405s, so the range read is the lookup. A notes-only body
 * leaves rpe untouched and vice versa. Empty `notes` clears the note. Coach-visible.
 */
export async function setAthleteWorkoutNote(
  client: TrainHeroicClient,
  args: {
    date: string;
    programWorkoutId: number | string;
    notes?: string | undefined;
    rpe?: number | undefined;
  },
): Promise<AthleteWorkoutNoteOutput> {
  if (args.notes === undefined && args.rpe === undefined) {
    throw new Error("Provide notes and/or rpe.");
  }
  const programWorkoutId = coerceInt(args.programWorkoutId);
  if (programWorkoutId === null) {
    throw new Error(`Invalid programWorkoutId ${String(args.programWorkoutId)}.`);
  }
  const target = await programWorkoutOnDate(client, args.date, programWorkoutId);
  const saved = savedWorkoutOf(target);
  const savedWorkoutId = saved !== null ? coerceInt(saved.id) : null;
  if (savedWorkoutId === null) {
    throw new Error(
      `Workout ${programWorkoutId} on ${args.date} has no saved workout to attach a note to.`,
    );
  }
  const body = definedProps({ id: savedWorkoutId, notes: args.notes, rpe: args.rpe });
  const res = await client.request<unknown>("PUT", `/1.0/athlete/savedworkout/${savedWorkoutId}`, {
    body,
  });
  if (!res.ok) {
    throw new Error(`Set workout note failed (HTTP ${res.status}).`);
  }
  const data = isRecord(res.data) ? res.data : {};
  return {
    programWorkoutId,
    savedWorkoutId,
    date: args.date,
    notes: typeof data.notes === "string" ? data.notes : (args.notes ?? ""),
    rpe: coerceInt(data.rpe) ?? (args.rpe !== undefined ? args.rpe : null),
  };
}
