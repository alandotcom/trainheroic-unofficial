import { z } from "zod";
import { toolOutputSchema } from "@trainheroic-unofficial/dto";
import type {
  ProgramSessionRow,
  StoredMessage,
  StoredMessageStream,
  StoredWorkoutRow,
  WorkoutSyncResult,
} from "@trainheroic-unofficial/db";

/**
 * Output contracts for the eight D1-backed tools that exist only in the hosted Worker.
 * Shared core tools keep their contracts in `@trainheroic-unofficial/dto`; keeping only
 * warehouse results here prevents the shared packages from depending on Cloudflare storage.
 */

const nullableNumber = z.number().nullable();
const nullableString = z.string().nullable();

const workoutSyncSchema: z.ZodType<WorkoutSyncResult> = z.object({
  workouts: z.number().int().nonnegative(),
  exercises: z.number().int().nonnegative(),
  from: z.string(),
  to: z.string(),
});

const storedWorkoutSchema: z.ZodType<StoredWorkoutRow> = z.object({
  id: z.number(),
  date: nullableString,
  title: nullableString,
  program_title: nullableString,
  team_title: nullableString,
  logged: z.boolean(),
});

const storedWorkoutExerciseSchema = z.looseObject({
  block_order: nullableNumber,
  block_title: nullableString,
  is_test: nullableNumber,
  exercise_id: nullableNumber,
  title: nullableString,
  units: z.json(),
  prescribed: z.json(),
  performed: z.json(),
  instruction: nullableString,
});

const exerciseSyncSchema = z.object({
  exerciseId: z.number(),
  sessions: z.number().int().nonnegative(),
  prs: z.number().int().nonnegative(),
  error: z.string().optional(),
});

const trainingSyncSchema = z.union([
  exerciseSyncSchema,
  z.object({
    catalog: z.number().int().nonnegative(),
    workingMaxes: z.number().int().nonnegative(),
    exercisesSynced: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    results: z.array(exerciseSyncSchema),
  }),
]);

const storedExerciseSchema = z.object({
  id: z.number(),
  title: z.string(),
  param_1_type: nullableNumber,
  param_2_type: nullableNumber,
  is_circuit: nullableNumber,
});

const storedExerciseSessionSchema = z.object({
  date: nullableString,
  abr: nullableString,
  best_estimated_1rm: nullableNumber,
  program_workout_id: nullableNumber,
  saved_workout_set_exercise_id: z.number(),
});

const storedPrSchema = z.object({
  description: nullableString,
  reps: nullableNumber,
  weight: nullableNumber,
  units: nullableString,
  date: nullableString,
});

const storedWorkingMaxSchema = z.object({
  exercise_id: z.number(),
  title: nullableString,
  param_type: nullableNumber,
  value: nullableNumber,
  type_suffix: nullableString,
});

const calendarSyncSchema = z.object({
  program: z.number(),
  title: z.string(),
  sessions: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  prescribed_sets: z.number().int().nonnegative(),
  windows_failed: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

const storedProgramSessionSchema: z.ZodType<ProgramSessionRow> = z.object({
  id: z.number(),
  date: nullableString,
  title: nullableString,
  published: z.number(),
});

const storedSessionDetailSchema = z.object({
  sessionId: z.number(),
  blocks: z.array(z.looseObject({ id: z.number(), sets: z.array(z.looseObject({})) })),
});

const streamSyncSchema = z.object({
  stream: z.number(),
  title: z.string(),
  kind: z.string(),
  new: z.number().int().nonnegative(),
  error: z.string().optional(),
});

const storedMessageStreamSchema: z.ZodType<StoredMessageStream> = z.object({
  id: z.number(),
  kind: nullableString,
  title: nullableString,
  team_id: nullableNumber,
  user_id: nullableNumber,
  last_viewed: nullableNumber,
});

const storedMessageSchema: z.ZodType<StoredMessage> = z.object({
  id: z.number(),
  ts: nullableNumber,
  content: nullableString,
  author_name: nullableString,
  is_author: z.number(),
  parent_id: nullableNumber,
  reactions: z.json(),
});

export const hostedWarehouseOutputSchemas = {
  athlete_workouts_sync: toolOutputSchema(workoutSyncSchema),
  athlete_workouts_stored: toolOutputSchema(
    z.union([z.array(storedWorkoutSchema), z.array(storedWorkoutExerciseSchema)]),
  ),
  athlete_training_sync: toolOutputSchema(trainingSyncSchema),
  athlete_training_stored: toolOutputSchema(
    z.union([
      z.array(storedExerciseSchema),
      z.array(storedExerciseSessionSchema),
      z.array(storedPrSchema),
      z.array(storedWorkingMaxSchema),
    ]),
  ),
  programming_sync: toolOutputSchema(z.union([calendarSyncSchema, z.array(calendarSyncSchema)])),
  programming_stored: toolOutputSchema(
    z.union([z.array(storedProgramSessionSchema), storedSessionDetailSchema]),
  ),
  messaging_sync: toolOutputSchema(z.union([streamSyncSchema, z.array(streamSyncSchema)])),
  messaging_stored: toolOutputSchema(
    z.union([z.array(storedMessageStreamSchema), z.array(storedMessageSchema)]),
  ),
} as const;
