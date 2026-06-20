import { describe, expect, it } from "vitest";
import {
  exerciseResponseSchema,
  programsEditResponseSchema,
  sessionCreateResponseSchema,
} from "../src/responses";

describe("response schemas", () => {
  it("accepts a library row with string-or-number params, null, and extra fields", () => {
    const ok = exerciseResponseSchema.safeParse({
      id: 1,
      title: "Back Squat",
      param_1_type: "3",
      param_2_type: null,
      extra_field_we_dont_model: 1,
    });
    expect(ok.success).toBe(true);
  });

  it("accepts a single-param row (no param types) but flags a missing id or title", () => {
    expect(exerciseResponseSchema.safeParse({ id: 1, title: "Plank" }).success).toBe(true);
    expect(exerciseResponseSchema.safeParse({ title: "x", param_1_type: 3 }).success).toBe(false);
    expect(exerciseResponseSchema.safeParse({ id: 1, param_1_type: 3 }).success).toBe(false);
  });

  it("accepts the session-create response and flags a missing workout_id", () => {
    expect(sessionCreateResponseSchema.safeParse({ workout_id: 10, id: 20, foo: 1 }).success).toBe(
      true,
    );
    expect(sessionCreateResponseSchema.safeParse({ id: 20 }).success).toBe(false);
  });

  it("accepts the programs-edit response with sets as a dict", () => {
    const ok = programsEditResponseSchema.safeParse({
      programWorkouts: [{ id: 20, sets: { "1": { order: 1 } } }],
    });
    expect(ok.success).toBe(true);
  });
});
