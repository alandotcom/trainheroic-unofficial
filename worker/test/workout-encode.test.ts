import { describe, expect, it } from "vitest";
import {
  buildBlockPayload,
  makeExercise,
  repsList,
  resolveLeaderboard,
  unitAdvisory,
} from "../src/workout/encode";

describe("repsList", () => {
  it("uses a rep list as-is", () => {
    expect(repsList({ id: 1, reps: [10, 10, 8] })).toEqual(["10", "10", "8"]);
  });
  it("broadcasts a scalar over sets", () => {
    expect(repsList({ id: 1, reps: 10, sets: 3 })).toEqual(["10", "10", "10"]);
  });
  it("returns empty when reps are absent", () => {
    expect(repsList({ id: 1 })).toEqual([]);
  });
});

describe("makeExercise", () => {
  it("fills all ten param slots (the HTTP 500 guard)", () => {
    const ex = makeExercise(
      { id: 1162, title: "Bench Press", reps: [10, 10, 8, 8], rpe: 8 },
      555,
      1,
      "k::5001",
    );
    for (let i = 1; i <= 10; i += 1) {
      expect(ex).toHaveProperty(`param_1_data_${i}`);
      expect(ex).toHaveProperty(`param_2_data_${i}`);
    }
    expect(ex.param_1_data_1).toBe("10");
    expect(ex.param_1_data_4).toBe("8");
    expect(ex.param_1_data_5).toBe("");
    expect(ex.set_num).toBe(4);
    expect(ex.param_count).toBe(4);
    expect(ex.param_1_type).toBe(3);
    expect(ex.exercise_id).toBe(1162);
    expect(ex.workout_set_id).toBe(555);
    expect(ex.eType).toBe("e");
  });

  it("routes RPE into the instruction and leaves load blank (param_2_type 0)", () => {
    const ex = makeExercise({ id: 1, reps: [5, 5, 5], rpe: 8 }, 9, 1, "k");
    expect(ex.instruction).toBe("RPE 8");
    expect(ex.param_2_type).toBe(0);
    expect(ex.param_2_data_1).toBe("");
  });

  it("encodes a prescribed weight list as param_2_type 1", () => {
    const ex = makeExercise({ id: 1, reps: [5, 5, 5], weight: [185, 205, 225] }, 9, 1, "k");
    expect(ex.param_2_type).toBe(1);
    expect(ex.param_2_data_1).toBe("185");
    expect(ex.param_2_data_3).toBe("225");
    expect(ex.param_2_data_4).toBe("");
  });

  it("broadcasts a scalar weight across the rep count", () => {
    const ex = makeExercise({ id: 1, reps: [5, 5, 5], weight: 135 }, 9, 1, "k");
    expect(ex.param_2_data_1).toBe("135");
    expect(ex.param_2_data_3).toBe("135");
  });

  it("lets an explicit instr override the auto RPE note", () => {
    const ex = makeExercise(
      { id: 903, sets: 3, reps: 12, instr: "to near failure", rpe: 8 },
      9,
      1,
      "k",
    );
    expect(ex.instruction).toBe("to near failure");
    expect(ex.set_num).toBe(3);
  });

  it("keeps a scalar weight with no reps (regression: weight-only set)", () => {
    const ex = makeExercise({ id: 1, weight: 315 }, 9, 1, "k");
    expect(ex.param_2_type).toBe(1);
    expect(ex.param_2_data_1).toBe("315");
    expect(ex.param_count).toBe(1);
    expect(ex.set_num).toBe(1);
  });

  it("uses the sets count for a weight-only prescription", () => {
    const ex = makeExercise({ id: 1, weight: 200, sets: 3 }, 9, 1, "k");
    expect(ex.param_2_data_1).toBe("200");
    expect(ex.param_2_data_3).toBe("200");
    expect(ex.set_num).toBe(3);
  });

  it("keeps a weight array with no reps", () => {
    const ex = makeExercise({ id: 1, weight: [100, 110] }, 9, 1, "k");
    expect(ex.param_2_data_1).toBe("100");
    expect(ex.param_2_data_2).toBe("110");
    expect(ex.set_num).toBe(2);
  });
});

describe("resolveLeaderboard", () => {
  const block = (leaderboard?: unknown) =>
    ({ title: "x", exercises: [], leaderboard }) as Parameters<typeof resolveLeaderboard>[0];

  it("maps a unit string", () => {
    expect(resolveLeaderboard(block("rounds"))).toMatchObject({
      isRedzone: 1,
      redzoneType: 3,
      smallerIsBetter: 0,
    });
  });
  it("defaults to lowest-wins for time", () => {
    expect(resolveLeaderboard(block("time")).smallerIsBetter).toBe(1);
  });
  it("honors an explicit lowest_wins object", () => {
    expect(resolveLeaderboard(block({ unit: "reps", lowest_wins: true }))).toMatchObject({
      redzoneType: 2,
      smallerIsBetter: 1,
    });
  });
  it("accepts a raw redzone_type int", () => {
    expect(resolveLeaderboard(block(3)).redzoneType).toBe(3);
  });
  it("returns no leaderboard when absent", () => {
    expect(resolveLeaderboard(block())).toMatchObject({ isRedzone: null, redzoneType: 0 });
  });
  it("throws on an unknown unit", () => {
    expect(() => resolveLeaderboard(block("bogus"))).toThrow(/unknown leaderboard/iu);
  });
});

describe("buildBlockPayload", () => {
  it("orders blocks, keys them, and encodes leaderboards", () => {
    const payload = buildBlockPayload(
      [
        { title: "A", exercises: [] },
        { title: "B", exercises: [], leaderboard: "reps" },
      ],
      500,
    );
    expect(payload[0]).toMatchObject({
      order: 1,
      type: 2,
      title: "A",
      key: "k::5001",
      redzone_type: 0,
      is_redzone: null,
    });
    expect(payload[1]).toMatchObject({ order: 2, title: "B", redzone_type: 2, is_redzone: 1 });
  });
});

describe("unitAdvisory", () => {
  it("warns when a sent primary unit will be overridden", () => {
    const a = unitAdvisory("Cardio", { id: 1, param_1_type: 6 }, { param1: 10, param2: null });
    expect(a.warnings[0]).toMatch(/ignored/u);
  });
  it("notes a non-rep fixed primary unit", () => {
    const a = unitAdvisory("Cardio", { id: 1 }, { param1: 10, param2: null });
    expect(a.notes[0]).toMatch(/mi/u);
  });
  it("warns that RPE in a weight slot will not stick", () => {
    const a = unitAdvisory(
      "Press",
      { id: 1, weight: [100], param_2_type: 14 },
      { param1: 3, param2: 1 },
    );
    expect(a.warnings[0]).toMatch(/does not stick/u);
  });
  it("is silent when the spec matches the fixed units", () => {
    const a = unitAdvisory("Press", { id: 1, reps: [5] }, { param1: 3, param2: 1 });
    expect(a.notes).toHaveLength(0);
    expect(a.warnings).toHaveLength(0);
  });
});
