import { describe, expect, it } from "vitest";
import { blockSpecSchema, workoutSpecSchema } from "../src/workout";

describe("workout schemas", () => {
  it("accepts a valid block", () => {
    const block = {
      title: "Primary",
      exercises: [{ id: 1162, reps: [10, 8], rpe: 8 }],
      leaderboard: "rounds",
    };
    expect(blockSpecSchema.parse(block).title).toBe("Primary");
  });

  it("rejects a block without a title or exercises", () => {
    expect(() => blockSpecSchema.parse({ exercises: [] })).toThrow();
    expect(() => blockSpecSchema.parse({ title: "x" })).toThrow();
  });

  it("rejects an exercise missing an id", () => {
    expect(() => blockSpecSchema.parse({ title: "x", exercises: [{ reps: 5 }] })).toThrow();
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
