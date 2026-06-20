import { z } from "zod";

/** A single exercise prescription inside a block. */
export const exerciseSpecSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().optional(),
  reps: z.union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))]).optional(),
  sets: z.number().optional(),
  weight: z.union([z.number(), z.array(z.number())]).optional(),
  rpe: z.union([z.number(), z.string()]).optional(),
  instr: z.string().optional(),
  param_1_type: z.number().optional(),
  param_2_type: z.number().optional(),
});
export type ExerciseSpec = z.infer<typeof exerciseSpecSchema>;

/** A block's Red-Zone leaderboard: a unit string/number, or an object with options. */
export const leaderboardSpecSchema = z.union([
  z.string(),
  z.number(),
  z.object({
    unit: z.union([z.string(), z.number()]).optional(),
    type: z.union([z.string(), z.number()]).optional(),
    lowest_wins: z.boolean().optional(),
    instruction: z.string().optional(),
  }),
]);
export type LeaderboardSpec = z.infer<typeof leaderboardSpecSchema>;

/** A block (group of exercises); two exercises render as a superset. */
export const blockSpecSchema = z.object({
  title: z.string(),
  type: z.number().optional(),
  instruction: z.string().optional(),
  leaderboard: leaderboardSpecSchema.optional(),
  exercises: z.array(exerciseSpecSchema),
});
export type BlockSpec = z.infer<typeof blockSpecSchema>;

/** A full session spec: the blocks plus an optional session note (Coach Instructions). */
export const workoutSpecSchema = z.object({
  blocks: z.array(blockSpecSchema),
  instruction: z.string().optional(),
});
export type WorkoutSpec = z.infer<typeof workoutSpecSchema>;
