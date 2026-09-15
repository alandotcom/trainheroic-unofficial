import { describe, expect, it } from "vitest";
import {
  exerciseCreateSchema,
  exerciseGetOutputSchema,
  exerciseUpdateSchema,
  exerciseViewSchema,
  toolOutputSchema,
} from "../src/index";

const presentedGet = {
  id: 1,
  title: "Back Squat",
  units: ["reps", "lb"],
  can_edit: 0,
  user_id: null,
  use_count: 12,
  muscle_group: "legs",
};

describe("exercise output schemas", () => {
  it("keeps extra library fields that exerciseViewSchema would strip", () => {
    expect(exerciseViewSchema.parse(presentedGet)).toEqual({
      id: 1,
      title: "Back Squat",
      can_edit: 0,
      user_id: null,
      use_count: 12,
      units: ["reps", "lb"],
    });
    expect(exerciseGetOutputSchema.parse(presentedGet)).toEqual(presentedGet);
    expect(toolOutputSchema(exerciseGetOutputSchema).parse(presentedGet)).toEqual(presentedGet);
  });

  it("accepts a raw library id as a string and rejects a row without units", () => {
    expect(
      exerciseGetOutputSchema.safeParse({
        id: "1",
        title: "Plank",
        units: [null, null],
      }).success,
    ).toBe(true);
    expect(exerciseGetOutputSchema.safeParse({ id: 1, title: "Plank" }).success).toBe(false);
  });
});

describe("exercise write schemas", () => {
  it("supplies the provider-required points_of_performance field on create", () => {
    expect(exerciseCreateSchema.parse({ title: "Made" })).toEqual({
      title: "Made",
      points_of_performance: "",
    });
  });

  it("does not default points_of_performance on update", () => {
    expect(exerciseUpdateSchema.parse({ title: "Renamed" })).toEqual({ title: "Renamed" });
  });

  it("rejects blank titles and unknown parameter types", () => {
    expect(exerciseCreateSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(exerciseCreateSchema.safeParse({ title: "Made", param_1_type: 999 }).success).toBe(
      false,
    );
  });
});
