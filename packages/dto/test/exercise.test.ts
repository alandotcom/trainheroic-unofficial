import { describe, expect, it } from "vitest";
import { exerciseGetOutputSchema, exerciseViewSchema, toolOutputSchema } from "../src/index";

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
