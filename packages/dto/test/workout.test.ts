import { describe, expect, it } from "vitest";
import { blockSpecSchema, parseWorkoutDate, workoutSpecSchema } from "../src/workout";

describe("workout schemas", () => {
  it("accepts a valid block", () => {
    const block = {
      title: "Primary",
      exercises: [{ id: 1162, reps: [10, 8], rpe: 8 }],
      leaderboard: "rounds",
    };
    expect(blockSpecSchema.parse(block).title).toBe("Primary");
  });

  it("rejects a block without a title", () => {
    expect(() => blockSpecSchema.parse({ exercises: [] })).toThrow();
  });

  it("rejects a block missing the exercises field", () => {
    expect(() => blockSpecSchema.parse({ title: "x" })).toThrow();
  });

  it("rejects an empty-exercise block without instruction", () => {
    expect(() => blockSpecSchema.parse({ title: "Prep", exercises: [] })).toThrow(/instruction/iu);
  });

  it("accepts a text-only Circuit / Conditioning block (empty exercises + instruction)", () => {
    const block = blockSpecSchema.parse({
      title: "Prep",
      exercises: [],
      instruction: "3 rounds: 10 air squats, 10 push-ups, 200m run",
    });
    expect(block.exercises).toEqual([]);
    expect(block.instruction).toMatch(/3 rounds/u);
  });

  it("rejects an exercise missing an id", () => {
    expect(() => blockSpecSchema.parse({ title: "x", exercises: [{ reps: 5 }] })).toThrow();
  });

  it("rejects mismatched per-set reps and weight arrays", () => {
    expect(() =>
      blockSpecSchema.parse({
        title: "Strength",
        exercises: [{ id: 1, reps: [5, 5], weight: [100, 110, 120] }],
      }),
    ).toThrow(/same length/iu);
  });

  it("parses a full workout spec with a session instruction", () => {
    const spec = workoutSpecSchema.parse({
      blocks: [{ title: "A", exercises: [{ id: 1, reps: 5 }] }],
      instruction: "Welcome to Week 12",
    });
    expect(spec.instruction).toBe("Welcome to Week 12");
    expect(spec.blocks).toHaveLength(1);
  });

  it("rejects unknown leaderboard object keys loosely (accepts object form)", () => {
    const block = blockSpecSchema.parse({
      title: "A",
      exercises: [{ id: 1 }],
      leaderboard: { unit: "time", lowest_wins: true },
    });
    expect(block.leaderboard).toEqual({ unit: "time", lowest_wins: true });
  });
});

describe("parseWorkoutDate", () => {
  it("parses YYYY-M-D and YYYY-MM-DD", () => {
    expect(parseWorkoutDate("2026-6-2")).toEqual([2026, 6, 2]);
    expect(parseWorkoutDate("2026-06-02")).toEqual([2026, 6, 2]);
  });

  it("rejects a blank part, non-digits, and an impossible month or day", () => {
    expect(() => parseWorkoutDate("2026-9-")).toThrow(/YYYY-M-D/u);
    expect(() => parseWorkoutDate("2026-06-02T00:00")).toThrow(/YYYY-M-D/u);
    expect(() => parseWorkoutDate("2026-0-5")).toThrow(/real month and day/u);
    expect(() => parseWorkoutDate("2026-2-32")).toThrow(/real month and day/u);
  });
});
