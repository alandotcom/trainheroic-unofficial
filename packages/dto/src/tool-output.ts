import { z } from "zod";
import {
  athletePrefsSchema,
  athleteProfileSummarySchema,
  athleteUserSchema,
  athleteWorkingMaxListSchema,
  exerciseHistoryDetailSchema,
  exerciseStatsSchema,
  personalRecordListSchema,
  programWorkoutListSchema,
  userSimpleSchema,
} from "./athlete";
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

/** Every budget fallback stays valid structured JSON and carries this marker. */
export const truncatedOutputSchema = z.looseObject({
  preview: z.string().optional(),
  items: z.array(z.json()).optional(),
  __truncated: truncationMarkerSchema,
});

/** Add the shared size-budget fallback to a tool's natural result shape. */
export function toolOutputSchema<T extends z.ZodType>(schema: T) {
  return z.union([schema, truncatedOutputSchema]);
}

export const opaqueJsonOutputSchema = z.json();

export const athleteProfileOutputSchema = z.looseObject({
  summary: athleteProfileSummarySchema,
  user: athleteUserSchema,
});

const athleteWorkoutExerciseOutputSchema = z.object({
  exerciseId: nullableNumber,
  title: z.string(),
  instruction: nullableString,
  units: z.array(nullableString),
  prescribed: z.array(z.string()),
  performed: z.array(z.string()),
});

const athleteWorkoutBlockOutputSchema = z.object({
  order: z.number(),
  title: nullableString,
  instruction: nullableString,
  isTest: z.boolean(),
  exercises: z.array(athleteWorkoutExerciseOutputSchema),
});

const athleteWorkoutOutputSchema = z.object({
  id: nullableNumber,
  date: z.string(),
  title: z.string(),
  program: nullableString,
  team: nullableString,
  instruction: nullableString,
  logged: z.boolean(),
  personal: z.boolean(),
  blocks: z.array(athleteWorkoutBlockOutputSchema),
});

const athleteWorkoutSummaryOutputSchema = z.object({
  id: nullableNumber,
  date: z.string(),
  title: z.string(),
  program: nullableString,
  team: nullableString,
  logged: z.boolean(),
  personal: z.boolean(),
  exerciseCount: z.number().int().nonnegative(),
  performedCount: z.number().int().nonnegative(),
});

export const athleteWorkoutsOutputSchema = z.union([
  programWorkoutListSchema,
  z.array(athleteWorkoutOutputSchema),
  z.array(athleteWorkoutSummaryOutputSchema),
]);

export const athleteExerciseCatalogOutputSchema = z.array(
  z.object({
    id: z.union([z.number(), z.string()]),
    title: z.string(),
    isCircuit: z.boolean(),
    units: z.array(nullableString),
  }),
);

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
      prescribed: z.array(z.string()),
      performed: z.array(z.string()),
    }),
  ),
});

export const logTargetsOutputSchema = z.union([
  programWorkoutListSchema,
  z.array(logSetTargetOutputSchema),
]);

export const presentedExerciseHistoryOutputSchema = z.object({
  liftPRs: z.array(
    z.object({
      description: nullableString,
      reps: nullableNumber,
      weight: nullableNumber,
      units: nullableString,
      date: nullableString,
    }),
  ),
  sessions: z.array(
    z.object({
      date: z.string(),
      abr: nullableString,
      estimated1RM: nullableNumber,
      sets: z.array(z.object({ setNumber: z.number(), value: nullableString })),
    }),
  ),
});

export const exerciseHistoryOutputSchema = z.union([
  exerciseHistoryDetailSchema,
  presentedExerciseHistoryOutputSchema,
]);

export const coachAthleteTrainingOutputSchema = z.object({
  athleteId: nullableNumber,
  athleteName: nullableString,
  year: z.number().int(),
  month: z.number().int(),
  sessions: z.array(
    z.object({
      workoutId: nullableNumber,
      savedWorkoutId: nullableNumber,
      title: z.string(),
      logged: z.boolean(),
      completed: z.boolean(),
      rpe: nullableNumber,
      durationMin: nullableNumber,
      notes: nullableString,
      exercises: z.array(
        z.object({
          exerciseId: nullableNumber,
          title: z.string(),
          summary: nullableString,
          completed: z.boolean(),
        }),
      ),
    }),
  ),
});

export const rosterActivityOutputSchema = z.array(
  z.object({
    athleteId: z.number(),
    sessionsCount: nullableNumber,
    firstLoggedDate: nullableString,
    lastLoggedDate: nullableString,
    totalReps: nullableNumber,
    totalVolume: nullableNumber,
  }),
);

export const teamVolumeOutputSchema = z.object({
  window: z.object({ start: z.string(), end: z.string() }),
  athletes: z.array(
    z.object({
      athleteId: z.number(),
      name: nullableString,
      sessions: z.number(),
      reps: z.number(),
      volume: z.number(),
      firstLoggedDate: nullableString,
      lastLoggedDate: nullableString,
    }),
  ),
  totals: z.object({
    athletes: z.number(),
    sessions: z.number(),
    reps: z.number(),
    volume: z.number(),
  }),
});

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

const exerciseViewOutputSchema = z.object({
  id: z.number(),
  title: z.string(),
  can_edit: z.number(),
  user_id: nullableNumber,
  use_count: z.number(),
  units: z.array(nullableString),
});

export const exerciseResolveOutputSchema = z.object({
  match: exerciseViewOutputSchema.nullable(),
  candidates: z.array(exerciseViewOutputSchema),
});

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

const athleteMainLiftPrsOutputSchema = z.object({
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

export const knownToolOutputSchemas = {
  athlete_whoami: userSimpleSchema,
  athlete_profile: athleteProfileOutputSchema,
  athlete_prefs: athletePrefsSchema,
  athlete_working_maxes: athleteWorkingMaxListSchema,
  athlete_workouts: athleteWorkoutsOutputSchema,
  athlete_log_targets: logTargetsOutputSchema,
  athlete_saved_workouts: logTargetsOutputSchema,
  athlete_exercises: athleteExerciseCatalogOutputSchema,
  athlete_exercise_history: exerciseHistoryOutputSchema,
  athlete_personal_records: personalRecordListSchema,
  athlete_exercise_stats: exerciseStatsSchema,
  athlete_training: coachAthleteTrainingOutputSchema,
  athlete_lift_history: exerciseHistoryOutputSchema,
  roster_activity: rosterActivityOutputSchema,
  team_volume: teamVolumeOutputSchema,
  athlete_main_lift_prs: athleteMainLiftPrsOutputSchema,
  roster_main_lift_prs: z.array(athleteMainLiftPrsOutputSchema),
  message_draft: messageDraftOutputSchema,
  message_send: messageSentOutputSchema,
  message_delete: messageDeletedOutputSchema,
  report_feedback: feedbackOutputSchema,
  athlete_invite: athleteInviteOutputSchema,
  athlete_session_create: personalWorkoutCreatedOutputSchema,
  athlete_session_remove: athleteSessionRemovedOutputSchema,
  athlete_log_session: sessionLogOutputSchema,
  coach_log_session: sessionLogOutputSchema,
  athlete_log_set: setLogOutputSchema,
  log_athlete_set: setLogOutputSchema,
  athlete_prescribe_set: setPrescriptionOutputSchema,
  prescribe_athlete_set: setPrescriptionOutputSchema,
  athlete_swap_exercise: exerciseSwapOutputSchema,
  swap_athlete_exercise: exerciseSwapOutputSchema,
  exercise_delete: exerciseDeletedOutputSchema,
  exercise_forget: exerciseForgottenOutputSchema,
  exercise_create: exerciseResponseSchema,
  exercise_update: exerciseResponseSchema,
  exercise_get: exerciseViewOutputSchema,
  exercise_search: z.array(exerciseViewOutputSchema),
  exercise_resolve: exerciseResolveOutputSchema,
  program_create: programCreatedOutputSchema,
  program_delete: programDeletedOutputSchema,
  workout_build: workoutBuildOutputSchema,
  workout_read: workoutReadOutputSchema,
  workout_publish: workoutPublishOutputSchema,
  session_remove: removedSessionOutputSchema,
  session_template_create: sessionTemplateCreatedOutputSchema,
} as const;

const wrappedToolOutputSchemas: Readonly<Record<string, z.ZodType>> = Object.fromEntries(
  Object.entries(knownToolOutputSchemas).map(([name, schema]) => [name, toolOutputSchema(schema)]),
);
const opaqueToolOutputSchema = toolOutputSchema(opaqueJsonOutputSchema);

/** The declared result shape for a shared/core tool, including the budget fallback. */
export function toolOutputSchemaFor(name: string): z.ZodType {
  return wrappedToolOutputSchemas[name] ?? opaqueToolOutputSchema;
}
