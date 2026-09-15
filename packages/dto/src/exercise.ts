import { z } from "zod";
import { idSchema } from "./common";

/** A library exercise row as the index stores it. */
export type ExerciseRow = {
  id: number;
  title: string;
  param_1_type: number | null;
  param_2_type: number | null;
  can_edit: number;
  user_id: number | null;
  use_count: number;
};

/**
 * A row presented for display. The raw param-type codes are dropped and the fixed
 * measurement units are surfaced positionally in `units`, ordered by entry slot
 * (param 1, then param 2). Positional, not semantic: param 2 is not always the load
 * — some exercises reverse the slots — so the units are not labelled by role.
 */
export const exerciseViewSchema = z.object({
  id: z.number(),
  title: z.string(),
  can_edit: z.number(),
  user_id: z.number().nullable(),
  use_count: z.number(),
  units: z.array(z.string().nullable()),
});
export type ExerciseView = z.infer<typeof exerciseViewSchema>;

/**
 * Full library object from `exercise_get`: the stored row with param-type codes
 * replaced by positional `units`. Extra API fields are preserved. Search/resolve
 * use the strict `exerciseViewSchema` projection instead.
 */
export const exerciseGetOutputSchema = z.looseObject({
  id: idSchema,
  title: z.string(),
  units: z.array(z.string().nullable()),
});
export type ExerciseGetOutput = z.infer<typeof exerciseGetOutputSchema>;

/** The outcome of resolving a name: a single match (or null) plus ranked candidates. */
export const exerciseResolveOutputSchema = z.object({
  match: exerciseViewSchema.nullable(),
  candidates: z.array(exerciseViewSchema),
});
export type ResolveResult = z.infer<typeof exerciseResolveOutputSchema>;

/** TrainHeroic's documented exercise parameter-type codes. */
export const exerciseParamTypeSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(10),
  z.literal(11),
  z.literal(12),
  z.literal(13),
  z.literal(14),
  z.literal(18),
]);

const exerciseWriteShape = {
  title: z.string().trim().min(1),
  param_1_type: exerciseParamTypeSchema.optional(),
  param_2_type: exerciseParamTypeSchema.optional(),
};

/** Body for creating a custom exercise; extra fields the API accepts are preserved. */
export const exerciseCreateSchema = z.looseObject({
  ...exerciseWriteShape,
  // TrainHeroic returns HTTP 500 when this key is absent, even though an empty value is valid.
  points_of_performance: z.string().default(""),
});
export type ExerciseCreate = z.input<typeof exerciseCreateSchema>;

/** Body for updating a custom exercise without clearing fields the caller omitted. */
export const exerciseUpdateSchema = z.looseObject({
  ...exerciseWriteShape,
  points_of_performance: z.string().optional(),
});
export type ExerciseUpdate = z.infer<typeof exerciseUpdateSchema>;
