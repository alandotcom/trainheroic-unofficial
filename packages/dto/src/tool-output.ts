import { z } from "zod";
import { programWorkoutListSchema } from "./athlete";
import { exerciseResponseSchema } from "./responses";

const nullableNumber = z.number().nullable();
const nullableString = z.string().nullable();

export const truncationMarkerSchema = z.looseObject({
  field: z.string().optional(),
  returned: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative(),
  omitted: z.number().int().nonnegative(),
  hint: z.string(),
});

/** Dedicated budget-fallback envelope. Never the natural tool shape. */
export const truncatedOutputSchema = z.looseObject({
  preview: z.string().optional(),
  items: z.array(z.json()).optional(),
  __truncated: truncationMarkerSchema,
});

/**
 * Add the shared size-budget fallback to a tool's natural result shape.
 * Truncation is a dedicated `{ items|preview, __truncated }` envelope, so it cannot
 * validate as the natural object and drop the marker.
 */
export function toolOutputSchema<T extends z.ZodType>(schema: T) {
  return z.union([truncatedOutputSchema, schema]);
}

export const opaqueJsonOutputSchema = z.json();
/** Explicit passthrough for tools whose live API payload is not yet contracted. */
export const opaqueOutputSchema = toolOutputSchema(opaqueJsonOutputSchema);

const logSetTargetOutputSchema = z.object({
  date: z.string(),
  workoutTitle: z.string(),
  program: nullableString,
  programId: nullableNumber,
  team: nullableString,
  teamId: nullableNumber,
  savedWorkoutSetId: z.number(),
  setTitle: nullableString,
  exercises: z.array(
    z.object({
      savedWorkoutSetExerciseId: z.number(),
      title: z.string(),
      units: z.array(nullableString),
      notes: nullableString,
      prescribed: z.array(z.string()),
      performed: z.array(z.string()),
    }),
  ),
});

export const logTargetsOutputSchema = z.union([
  z.array(logSetTargetOutputSchema),
  programWorkoutListSchema,
]);

export const messageDraftOutputSchema = z.object({
  draft: z.literal(true),
  note: z.string(),
  would_POST: z.string(),
  payload: z.json(),
});

export const feedbackOutputSchema = z.looseObject({
  status: z.enum(["sent", "logged"]),
  reference: z.string().optional(),
  note: z.string(),
});

export const removedSessionOutputSchema = z.looseObject({
  removed: z.union([z.boolean(), z.number()]),
});

export const athleteSessionRemovedOutputSchema = z.object({
  removed: z.literal(true),
  programWorkoutId: z.number(),
  date: z.string(),
});

export const athleteInviteOutputSchema = z.object({
  invited: z.literal(true),
  teamId: z.number(),
  result: z.json().optional(),
});

export const setLogOutputSchema = z.object({
  savedWorkoutSetId: z.number(),
  exercisesLogged: z.number().int().nonnegative(),
  setCompleted: z.boolean(),
});

export const setPrescriptionOutputSchema = z.object({
  savedWorkoutSetId: z.number(),
  exercisesPrescribed: z.number().int().nonnegative(),
});

export const exerciseSwapOutputSchema = z.object({
  savedWorkoutSetExerciseId: z.number(),
  athleteId: nullableNumber,
  newExerciseId: z.number(),
  newExerciseTitle: nullableString,
  originalTeamExerciseId: nullableNumber,
});

const sessionLogSetOutputSchema = z.object({
  savedWorkoutSetId: z.number(),
  exercisesLogged: z.number().int().nonnegative(),
});

export const sessionLogOutputSchema = z.object({
  date: z.string(),
  created: z.boolean(),
  sets: z.array(sessionLogSetOutputSchema),
  scheduledAlternatives: z
    .array(
      z.object({
        exerciseId: z.number(),
        title: z.string(),
        program: nullableString,
        workoutTitle: z.string(),
        savedWorkoutSetId: z.number(),
        savedWorkoutSetExerciseId: z.number(),
      }),
    )
    .optional(),
});

export const personalWorkoutCreatedOutputSchema = z.object({
  programWorkoutId: z.number(),
  workoutId: z.number(),
  savedWorkoutId: z.number(),
  groupId: z.number(),
  date: z.string(),
});

export const athleteWorkoutNoteOutputSchema = z.object({
  programWorkoutId: z.number(),
  savedWorkoutId: z.number(),
  date: z.string(),
  notes: z.string(),
  rpe: nullableNumber,
});
export type AthleteWorkoutNoteOutput = z.infer<typeof athleteWorkoutNoteOutputSchema>;

export const athleteExerciseNoteOutputSchema = z.object({
  savedWorkoutSetExerciseId: z.number(),
  notes: z.string(),
});
export type AthleteExerciseNoteOutput = z.infer<typeof athleteExerciseNoteOutputSchema>;

const workoutReadExerciseOutputSchema = z.object({
  order: z.number(),
  title: z.string(),
  reps: z.array(z.string()),
  primaryUnit: nullableString,
  load: z.array(z.string()),
  loadUnit: nullableString,
  instruction: z.string(),
});

const workoutReadBlockOutputSchema = z.object({
  order: z.number(),
  title: z.string(),
  instruction: z.string(),
  leaderboard: nullableString,
  exercises: z.array(workoutReadExerciseOutputSchema),
});

export const workoutReadOutputSchema = z.object({
  pwId: z.number(),
  date: z.string(),
  published: z.json().optional(),
  instruction: z.string(),
  blocks: z.array(workoutReadBlockOutputSchema),
});

export const workoutBuildOutputSchema = z.object({
  pwId: z.number(),
  workoutId: z.number(),
  programId: z.number(),
  published: z.literal(false),
  advisories: z.object({ notes: z.array(z.string()), warnings: z.array(z.string()) }),
  readback: workoutReadOutputSchema.nullable(),
  note: z.string(),
});

export const workoutPublishOutputSchema = z.object({
  published: z.number(),
  readback: workoutReadOutputSchema,
  note: z.string(),
});

export const messageSentOutputSchema = z.object({
  sent: z.literal(true),
  comment: z.json(),
});

export const messageDeletedOutputSchema = z.object({
  deleted: z.literal(true),
  response: z.json().optional(),
});

export const exerciseDeletedOutputSchema = z.object({ deleted: z.number() });
export const exerciseForgottenOutputSchema = z.object({ forgotten: z.number() });
export const exerciseCreatedOutputSchema = exerciseResponseSchema;

export const sessionTemplateCreatedOutputSchema = z.looseObject({
  id: z.union([z.number(), z.string()]),
});

const mainLiftPrOutputSchema = z.object({
  family: z.enum(["cleanjerk", "snatch", "deadlift", "squat", "bench", "overhead"]),
  label: z.string(),
  exerciseId: nullableNumber,
  title: nullableString,
  weight: nullableNumber,
  reps: nullableNumber,
  units: nullableString,
  date: nullableString,
});

export const athleteMainLiftPrsOutputSchema = z.object({
  athleteId: z.number(),
  athleteName: nullableString,
  prs: z.array(mainLiftPrOutputSchema),
});

export const programCreatedOutputSchema = z.object({
  containerId: z.number(),
  programId: z.number(),
  title: z.string(),
  kind: z.enum(["calendar", "fixed"]),
  requestedName: z.string(),
  nameApplied: z.boolean(),
});

export const programDeletedOutputSchema = z.object({
  programId: z.number(),
  containerId: nullableNumber,
});
