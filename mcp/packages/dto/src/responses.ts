import { z } from "zod";

// Loose schemas for the API responses we extract fields from. They are passthrough
// (extra fields allowed) and tolerant of the number-or-string drift the API already
// shows, but they require the specific fields we depend on — so checkResponse() can
// warn when TrainHeroic renames or drops one. They are never used to reject a response.

const intLike = z.union([z.number(), z.string()]);
const intLikeOrNull = z.union([z.number(), z.string(), z.null()]);

/** An exercise as the library + create endpoints return it (only the fields we read). */
export const exerciseResponseSchema = z.looseObject({
  id: intLike,
  title: z.string(),
  // Many exercises have no secondary (or even primary) param, so these are optional;
  // when present they must still be the int-or-string shape we coerce.
  param_1_type: intLikeOrNull.optional(),
  param_2_type: intLikeOrNull.optional(),
});

/** The exercise library list (envelope already unwrapped). */
export const exerciseLibraryResponseSchema = z.array(exerciseResponseSchema);

/** The create-session response (a programWorkout): we read workout_id + id. */
export const sessionCreateResponseSchema = z.looseObject({
  workout_id: intLike,
  id: intLike,
});

/** A programWorkout from the calendar edit view (we match by id and walk sets). */
export const programWorkoutResponseSchema = z.looseObject({
  id: intLike,
  sets: z.record(z.string(), z.unknown()).optional(),
});

/** The calendar edit-view response we read sessions back from. */
export const programsEditResponseSchema = z.looseObject({
  programWorkouts: z.array(programWorkoutResponseSchema).optional(),
});
