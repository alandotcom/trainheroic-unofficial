import { describe, expect, it } from "vitest";
import {
  buildBlockPayload,
  collectAdvisories,
  defaultBlockType,
  findSetSplits,
  makeExercise,
  resolveExerciseUnits,
  repsList,
  resolveLeaderboard,
  setSplitSummary,
  splitOversizedBlocks,
  unitAdvisory,
} from "../src/workout-encode";

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

describe("splitOversizedBlocks", () => {
  it("leaves a ten-set block unchanged", () => {
    const blocks = [
      { title: "Squat", exercises: [{ id: 1, reps: Array.from({ length: 10 }, () => 5) }] },
    ];
    expect(findSetSplits(blocks)).toEqual([]);
    expect(splitOversizedBlocks(blocks)).toEqual(blocks);
  });

  it("splits eleven per-set values into consecutive same-titled blocks", () => {
    const blocks = [
      {
        title: "Squat",
        exercises: [
          {
            id: 1,
            title: "Back Squat",
            reps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
            weight: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111],
          },
        ],
      },
    ];

    expect(findSetSplits(blocks)).toEqual([
      {
        blockTitle: "Squat",
        exerciseTitle: "Back Squat",
        setCount: 11,
        blockCount: 2,
      },
    ]);
    expect(splitOversizedBlocks(blocks)).toEqual([
      {
        title: "Squat",
        exercises: [
          {
            id: 1,
            title: "Back Squat",
            reps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            weight: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
          },
        ],
      },
      {
        title: "Squat",
        exercises: [{ id: 1, title: "Back Squat", reps: [11], weight: [111] }],
      },
    ]);
  });

  it("chunks scalar prescriptions and keeps supersets aligned", () => {
    const blocks = [
      {
        title: "Strength",
        type: 2,
        instruction: "Alternate exercises",
        leaderboard: "weight",
        exercises: [
          { id: 1, title: "Press", sets: 21, reps: 5, weight: 100 },
          { id: 2, title: "Row", sets: 12, reps: 8, weight: 80 },
        ],
      },
    ];

    expect(splitOversizedBlocks(blocks)).toEqual([
      {
        title: "Strength",
        type: 2,
        instruction: "Alternate exercises",
        leaderboard: "weight",
        exercises: [
          { id: 1, title: "Press", sets: 10, reps: 5, weight: 100 },
          { id: 2, title: "Row", sets: 10, reps: 8, weight: 80 },
        ],
      },
      {
        title: "Strength",
        type: 2,
        exercises: [
          { id: 1, title: "Press", sets: 10, reps: 5, weight: 100 },
          { id: 2, title: "Row", sets: 2, reps: 8, weight: 80 },
        ],
      },
      {
        title: "Strength",
        type: 2,
        exercises: [{ id: 1, title: "Press", sets: 1, reps: 5, weight: 100 }],
      },
    ]);
    expect(setSplitSummary(blocks)).toContain("Press: 21 sets into 3 blocks");
  });

  it("splits an oversized weight-only prescription without losing values", () => {
    const weights = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
    const blocks = [
      { title: "Carries", exercises: [{ id: 1, title: "Farmer Carry", weight: weights }] },
    ];

    expect(splitOversizedBlocks(blocks)).toEqual([
      {
        title: "Carries",
        exercises: [{ id: 1, title: "Farmer Carry", weight: weights.slice(0, 10) }],
      },
      {
        title: "Carries",
        exercises: [{ id: 1, title: "Farmer Carry", weight: [200] }],
      },
    ]);
  });

  it("broadcasts scalar reps across an oversized per-set weight array", () => {
    const weights = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
    const blocks = [
      {
        title: "Deadlift",
        exercises: [{ id: 1, title: "Deadlift", reps: 5, weight: weights }],
      },
    ];

    expect(findSetSplits(blocks)).toMatchObject([{ setCount: 11, blockCount: 2 }]);
    expect(splitOversizedBlocks(blocks)).toEqual([
      {
        title: "Deadlift",
        exercises: [{ id: 1, title: "Deadlift", sets: 10, reps: 5, weight: weights.slice(0, 10) }],
      },
      {
        title: "Deadlift",
        exercises: [{ id: 1, title: "Deadlift", sets: 1, reps: 5, weight: [200] }],
      },
    ]);
  });

  it("preserves sets when an empty reps array uses scalar weight", () => {
    const blocks = [
      {
        title: "Carry",
        exercises: [{ id: 1, title: "Farmer Carry", reps: [], sets: 11, weight: 100 }],
      },
    ];

    expect(splitOversizedBlocks(blocks)).toEqual([
      {
        title: "Carry",
        exercises: [{ id: 1, title: "Farmer Carry", reps: [], sets: 10, weight: 100 }],
      },
      {
        title: "Carry",
        exercises: [{ id: 1, title: "Farmer Carry", reps: [], sets: 1, weight: 100 }],
      },
    ]);
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
        { title: "A", exercises: [{ id: 1, reps: [5] }] },
        { title: "B", exercises: [{ id: 2, reps: [3] }], leaderboard: "reps" },
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

  it("defaults text-only blocks to Conditioning type 1 and keeps the instruction", () => {
    const payload = buildBlockPayload(
      [
        {
          title: "Prep Circuit",
          instruction: "3 rounds for quality:\n10 air squats\n10 push-ups",
          exercises: [],
        },
      ],
      500,
    );
    expect(payload[0]).toMatchObject({
      order: 1,
      type: 1,
      title: "Prep Circuit",
      instruction: "3 rounds for quality:\n10 air squats\n10 push-ups",
      exercises: [],
    });
  });

  it("honors an explicit type on a text-only block", () => {
    const payload = buildBlockPayload(
      [{ title: "Note", type: 4, instruction: "Rest day notes", exercises: [] }],
      1,
    );
    expect(payload[0]?.type).toBe(4);
  });
});

describe("defaultBlockType", () => {
  it("returns Conditioning for text-only blocks and Hypertrophy otherwise", () => {
    expect(defaultBlockType({ title: "A", exercises: [], instruction: "x" })).toBe(1);
    expect(defaultBlockType({ title: "A", exercises: [{ id: 1 }] })).toBe(2);
    expect(defaultBlockType({ title: "A", type: 4, exercises: [{ id: 1 }] })).toBe(4);
  });
});

describe("unitAdvisory", () => {
  it("notes a primary unit set in place of the library default", () => {
    const a = unitAdvisory(
      "Cardio / Run",
      { id: 1, reps: [200], param_1_type: 6 },
      { param1: 10, param2: null },
    );
    expect(a.notes[0]).toMatch(/primary values are in m, .*default mi/u);
    expect(a.warnings).toHaveLength(0);
  });
  it("notes a non-rep default primary unit", () => {
    const a = unitAdvisory(
      "Cardio / Run",
      { id: 1, reps: [2], param_1_type: 10 },
      { param1: 10, param2: null },
    );
    expect(a.notes[0]).toMatch(/values are in mi \(the exercise's default primary unit\)/u);
  });
  it("notes a %max load set in place of a pounds default", () => {
    const a = unitAdvisory(
      "Squat / Back Squat",
      { id: 1, weight: [70], param_2_type: 2 },
      { param1: 3, param2: 1 },
    );
    expect(a.notes[0]).toMatch(/secondary values are in %max, .*default lb/u);
    expect(a.warnings).toHaveLength(0);
  });
  it("treats pounds in an unset secondary slot as added load", () => {
    const a = unitAdvisory(
      "Pull-up",
      { id: 1, weight: [20], param_2_type: 1 },
      { param1: 3, param2: 0 },
    );
    expect(a.notes).toHaveLength(0);
  });
  it("is silent when the spec matches the default units", () => {
    const a = unitAdvisory(
      "Press",
      { id: 1, reps: [5], param_1_type: 3, param_2_type: 1 },
      { param1: 3, param2: 1 },
    );
    expect(a.notes).toHaveLength(0);
    expect(a.warnings).toHaveLength(0);
  });
});

describe("resolveExerciseUnits", () => {
  const index = {
    currentDefaultsMany: async () =>
      new Map([
        [1, { param1: 3, param2: 1 }],
        [82, { param1: 10, param2: 0 }],
        [7, { param1: 3, param2: 4 }],
      ]),
  };

  it("maps a stated unit that differs from the library default to its own type", async () => {
    const { blocks } = await resolveExerciseUnits(
      [
        {
          title: "Main",
          exercises: [
            { id: 1, reps: 5, primaryUnit: "reps", weight: [70, 75], secondaryUnit: "%max" },
            { id: 82, reps: 200, primaryUnit: "meters" },
          ],
        },
      ],
      index,
    );
    expect(blocks[0]?.exercises[0]).toMatchObject({ param_1_type: 3, param_2_type: 2 });
    expect(blocks[0]?.exercises[1]).toMatchObject({ param_1_type: 6, param_2_type: 0 });
  });

  it("keeps the library default when it has the stated unit, including sec on a time slot", async () => {
    const { blocks } = await resolveExerciseUnits(
      [
        {
          title: "Hold",
          exercises: [{ id: 7, reps: 1, primaryUnit: "reps", weight: 30, secondaryUnit: "sec" }],
        },
      ],
      index,
    );
    expect(blocks[0]?.exercises[0]).toMatchObject({ param_1_type: 3, param_2_type: 4 });
  });

  it("accepts an explicit param type that agrees with the stated unit", async () => {
    const { blocks } = await resolveExerciseUnits(
      [
        {
          title: "Main",
          exercises: [{ id: 1, weight: 30, secondaryUnit: "sec", param_2_type: 18 }],
        },
      ],
      index,
    );
    expect(blocks[0]?.exercises[0]).toMatchObject({ param_2_type: 18 });
  });

  it("resolves pounds in an unset secondary slot as added load without a note", async () => {
    const { blocks, advisories } = await resolveExerciseUnits(
      [
        {
          title: "Run",
          exercises: [{ id: 82, reps: 1, primaryUnit: "mi", weight: 20, secondaryUnit: "lb" }],
        },
      ],
      index,
    );
    expect(blocks[0]?.exercises[0]).toMatchObject({ param_1_type: 10, param_2_type: 1 });
    expect(advisories.notes).toEqual([
      "Run / 82: values are in mi (the exercise's default primary unit).",
    ]);
  });

  it("ignores an explicit param type on a slot without values and warns", async () => {
    const { blocks, advisories } = await resolveExerciseUnits(
      [{ title: "Squat", exercises: [{ id: 1, reps: 5, primaryUnit: "reps", param_2_type: 0 }] }],
      index,
    );
    expect(blocks[0]?.exercises[0]).toMatchObject({ param_2_type: 1 });
    expect(advisories.warnings[0]).toMatch(
      /param_2_type 0 is ignored because weight has no values/u,
    );
  });

  it("keeps the library default on a slot without values", async () => {
    const { blocks } = await resolveExerciseUnits(
      [{ title: "Squat", exercises: [{ id: 1, reps: 5, primaryUnit: "reps", rpe: 8 }] }],
      index,
    );
    expect(blocks[0]?.exercises[0]).toMatchObject({ param_1_type: 3, param_2_type: 1 });
  });
});

describe("collectAdvisories", () => {
  it("accepts stated distance and time units that match their exercise slots", async () => {
    const index = {
      currentDefaultsMany: async () =>
        new Map([
          [1, { param1: 6, param2: 0 }],
          [2, { param1: 3, param2: 4 }],
        ]),
    };
    await expect(
      collectAdvisories(
        [
          { title: "Run", exercises: [{ id: 1, reps: 200, primaryUnit: "meters" }] },
          {
            title: "Hold",
            exercises: [
              { id: 2, reps: 1, primaryUnit: "reps", weight: 30, secondaryUnit: "seconds" },
            ],
          },
        ],
        index,
      ),
    ).resolves.toMatchObject({ warnings: [] });
  });

  it("allows pounds in an exercise's unset secondary slot", async () => {
    const index = {
      currentDefaultsMany: async () => new Map([[1, { param1: 3, param2: 0 }]]),
    };
    await expect(
      collectAdvisories(
        [
          {
            title: "Pull-up",
            exercises: [{ id: 1, reps: 5, primaryUnit: "reps", weight: 20, secondaryUnit: "lb" }],
          },
        ],
        index,
      ),
    ).resolves.toMatchObject({ warnings: [] });
  });

  it.each([
    {
      name: "a stated unit that conflicts with an explicit param type",
      exercise: { id: 1, title: "Run", reps: 200, primaryUnit: "m", param_1_type: 10 },
      defaults: { param1: 10, param2: 0 },
      expected: /Run: primaryUnit m conflicts with param_1_type 10 \(mi\)/u,
    },
    {
      name: "a unit that names two param types",
      exercise: { id: 1, title: "Hold", weight: 30, secondaryUnit: "sec" },
      defaults: { param1: 3, param2: 1 },
      expected: /Hold: secondaryUnit sec matches .*4 and 18; set param_2_type/u,
    },
    {
      name: "an unknown unit",
      exercise: { id: 1, title: "Carry", weight: 30, secondaryUnit: "stone" },
      defaults: { param1: 3, param2: 1 },
      expected: /Carry.*unknown unit 'stone'/u,
    },
  ])("rejects $name before the draft is created", async ({ exercise, defaults, expected }) => {
    const index = {
      currentDefaultsMany: async () => new Map([[1, defaults]]),
    };
    await expect(
      collectAdvisories([{ title: "Conditioning", exercises: [exercise] }], index),
    ).rejects.toThrow(expected);
  });

  it("fetches current defaults for all unique exercise ids in one request", async () => {
    let requestedIds: readonly number[] = [];
    const index = {
      currentDefaultsMany: async (ids: readonly number[]) => {
        requestedIds = ids;
        return new Map([
          [1, { param1: 3, param2: 1 }],
          [2, { param1: 10, param2: null }],
        ]);
      },
    };

    const result = await collectAdvisories(
      [
        {
          title: "Strength",
          exercises: [
            { id: 1, reps: 5, primaryUnit: "reps" },
            { id: 2, reps: 400, primaryUnit: "mi" },
            { id: 1, reps: 3, primaryUnit: "reps" },
          ],
        },
      ],
      index,
    );

    expect(requestedIds).toEqual([1, 2]);
    expect(result.notes).toHaveLength(1);
  });
});
