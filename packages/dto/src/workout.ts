import { z } from "zod";

/** A single exercise prescription inside a block. */
export const exerciseSpecSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    title: z.string().optional(),
    reps: z.union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))]).optional(),
    sets: z.number().optional(),
    weight: z.union([z.number(), z.array(z.number())]).optional(),
    rpe: z.union([z.number(), z.string()]).optional(),
    instr: z.string().optional(),
    param_1_type: z.number().optional(),
    param_2_type: z.number().optional(),
  })
  .superRefine((exercise, ctx) => {
    if (
      Array.isArray(exercise.reps) &&
      Array.isArray(exercise.weight) &&
      exercise.reps.length !== exercise.weight.length
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          `Per-set reps and weight arrays must have the same length; received ` +
          `${exercise.reps.length} reps and ${exercise.weight.length} weights.`,
        path: ["weight"],
      });
    }
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

/**
 * A block (group of exercises); two exercises render as a superset.
 * Empty `exercises` is allowed only with a non-empty `instruction` — that is TrainHeroic's
 * free-text Circuit / Conditioning block (type 1): title + instruction blurb, no linked lifts.
 */
export const blockSpecSchema = z
  .object({
    title: z.string(),
    type: z.number().optional(),
    instruction: z.string().optional(),
    leaderboard: leaderboardSpecSchema.optional(),
    exercises: z.array(exerciseSpecSchema),
  })
  .superRefine((block, ctx) => {
    if (block.exercises.length > 0) return;
    const instr = block.instruction?.trim() ?? "";
    if (instr === "") {
      ctx.addIssue({
        code: "custom",
        message:
          "A block with no exercises needs a non-empty instruction (text-only Circuit / " +
          "Conditioning block). Otherwise provide at least one exercise.",
        path: ["exercises"],
      });
    }
  });
export type BlockSpec = z.infer<typeof blockSpecSchema>;

/** A full session spec: the blocks plus an optional session note (Coach Instructions). */
export const workoutSpecSchema = z.object({
  blocks: z.array(blockSpecSchema),
  instruction: z.string().optional(),
});
export type WorkoutSpec = z.infer<typeof workoutSpecSchema>;

/** A calendar date as the workout API expects it: [year, month, day]. */
export type WorkoutDate = readonly [number, number, number];

/**
 * Parse a `YYYY-M-D` string into the `WorkoutDate` tuple. The single home for this
 * conversion, shared by the MCP tools and the CLI so they cannot drift on what counts
 * as a valid date. Each part must be an integer.
 */
export function parseWorkoutDate(s: string): WorkoutDate {
  const parts = s.split("-").map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
    throw new Error(`date must be YYYY-M-D, got "${s}".`);
  }
  return [parts[0] as number, parts[1] as number, parts[2] as number];
}

/** Unit advisories surfaced when building: informational notes and override warnings. */
export type Advisory = { notes: string[]; warnings: string[] };

/** A single exercise as read back from a built session. */
export type ReadExercise = {
  order: number;
  title: string;
  reps: string[];
  primaryUnit: string | null;
  load: string[];
  loadUnit: string | null;
  instruction: string;
};

/** A block as read back from a built session. */
export type ReadBlock = {
  order: number;
  title: string;
  /** Block-level coach note (free-text Circuit / conditioning blurbs live here). */
  instruction: string;
  leaderboard: string | null;
  exercises: ReadExercise[];
};

/** A whole session read back from the calendar. */
export type ReadResult = {
  pwId: number;
  date: string;
  published: unknown;
  instruction: string;
  blocks: ReadBlock[];
};

/** Body for `POST /v5/sessions/template` (library create, not save-from-session). */
export const sessionTemplateCreateSchema = z.object({
  title: z.string().min(1),
  instruction: z.string().optional(),
});
export type SessionTemplateCreate = z.infer<typeof sessionTemplateCreateSchema>;
