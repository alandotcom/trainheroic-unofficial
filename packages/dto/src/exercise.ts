import { z } from "zod";

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

/** A row annotated with human-readable unit labels for display. */
export type ExerciseView = ExerciseRow & {
  param_1_unit: string | null;
  param_2_unit: string | null;
};

/** The outcome of resolving a name: a single match (or null) plus ranked candidates. */
export type ResolveResult = { match: ExerciseView | null; candidates: ExerciseView[] };

/** Body for creating a custom exercise; extra fields the API accepts are preserved. */
export const exerciseCreateSchema = z.looseObject({
  title: z.string().min(1),
  param_1_type: z.number().optional(),
  param_2_type: z.number().optional(),
});
export type ExerciseCreate = z.infer<typeof exerciseCreateSchema>;
