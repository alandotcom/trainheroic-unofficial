import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "../src/client";
import { ExerciseLibrary } from "../src/exercise-index";
import { MemoryLibraryCache } from "../src/library-cache";
import { buildSession, readSession } from "../src/workout-session";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// TrainHeroic answers saveWorkoutSetExercises with the saved rows, each carrying a new id.
function echoRows(init?: RequestInit): Response {
  const rows = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
  return json(rows.map((row, i) => ({ id: 900 + i, ...row })));
}

const index = {
  currentDefaultsMany: async (ids: readonly number[]) =>
    new Map(ids.map((id) => [id, { param1: 3, param2: 1 }])),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildSession", () => {
  it("reads current defaults when a cached exercise changed from meters to miles", async () => {
    const cache = new MemoryLibraryCache();
    await cache.save({
      fetchedAt: Date.now() - 24 * 60 * 60 * 1000,
      exercises: [{ id: 1, title: "Run", param_1_type: 6, param_2_type: 0 }],
    });
    const exercisePayloads: Array<Array<Record<string, unknown>>> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
      if (url.includes("/v5/exerciseLibrary/all")) {
        return json([{ id: 1, title: "Run", param_1_type: 10, param_2_type: 0 }]);
      }
      if (url.includes("/createWorkoutForDay/")) return json({ workout_id: 10, id: 20 });
      if (url.includes("/saveProgramWorkoutSets")) return json([{ order: 1, id: 101 }]);
      if (url.includes("/saveWorkoutSetExercises")) {
        exercisePayloads.push(JSON.parse(String(init?.body)) as Array<Record<string, unknown>>);
        return echoRows(init);
      }
      return json({ success: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new TrainHeroicClient("a@b.com", "pw");

    const result = await buildSession(client, {
      programId: 5,
      date: [2026, 6, 22],
      index: new ExerciseLibrary(client, cache),
      blocks: [{ title: "Conditioning", exercises: [{ id: 1, reps: 200, primaryUnit: "m" }] }],
    });

    // The live default is miles, so meters is an override and the insert asks for type 6.
    expect(result.advisories.notes[0]).toMatch(/in m, .*default mi/u);
    expect(exercisePayloads[0]?.[0]?.param_1_type).toBe(6);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.includes("/v5/exerciseLibrary/all")),
    ).toHaveLength(1);
  });

  it("does not write a draft when the current exercise library cannot be read", async () => {
    const cache = new MemoryLibraryCache();
    await cache.save({
      fetchedAt: Date.now() - 24 * 60 * 60 * 1000,
      exercises: [{ id: 1, title: "Run", param_1_type: 6, param_2_type: 0 }],
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
      return json({ message: "unavailable" }, 503);
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new TrainHeroicClient("a@b.com", "pw");

    await expect(
      buildSession(client, {
        programId: 5,
        date: [2026, 6, 22],
        index: new ExerciseLibrary(client, cache),
        blocks: [{ title: "Conditioning", exercises: [{ id: 1, reps: 200, primaryUnit: "m" }] }],
      }),
    ).rejects.toThrow(/Exercise library fetch failed.*503/iu);
    expect(fetchMock.mock.calls.some(([url]) => url.includes("/createWorkoutForDay/"))).toBe(false);
  });

  it.each([
    {
      name: "a unit that conflicts with an explicit param type",
      exercise: { id: 1, reps: 200, primaryUnit: "m", param_1_type: 10 },
      defaults: { param1: 10, param2: 0 },
      expected: /primaryUnit m conflicts with param_1_type 10/u,
    },
    {
      name: "a unit that names two param types",
      exercise: { id: 1, weight: 30, secondaryUnit: "sec" },
      defaults: { param1: 3, param2: 1 },
      expected: /secondaryUnit sec matches .*set param_2_type/u,
    },
  ])("rejects $name before any SDK write", async ({ exercise, defaults, expected }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      buildSession(new TrainHeroicClient("a@b.com", "pw"), {
        programId: 5,
        date: [2026, 6, 22],
        publish: true,
        index: {
          currentDefaultsMany: async () => new Map([[1, defaults]]),
        },
        blocks: [{ title: "Conditioning", exercises: [exercise] }],
      }),
    ).rejects.toThrow(expected);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // TrainHeroic stores an inserted row with the library types (lb for Back Squat) and keeps
  // %max only when the row is saved again by id; this mirrors that live behavior.
  function percentLoadBackend(keepOnUpdate: boolean) {
    const exercisePayloads: Array<Array<Record<string, unknown>>> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
      if (url.includes("/createWorkoutForDay/")) return json({ workout_id: 10, id: 20 });
      if (url.includes("/saveProgramWorkoutSets")) return json([{ order: 1, id: 101 }]);
      if (url.includes("/saveWorkoutSetExercises")) {
        const rows = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
        exercisePayloads.push(rows);
        return json(
          rows.map((row, i) => ({
            ...row,
            id: row.id ?? 900 + i,
            param_2_type: row.id !== undefined && keepOnUpdate ? row.param_2_type : 1,
          })),
        );
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    return exercisePayloads;
  }

  const percentSquatBlocks = [
    {
      title: "Squat",
      exercises: [
        {
          id: 1,
          title: "Back Squat",
          reps: 5,
          primaryUnit: "reps",
          weight: [70, 80],
          secondaryUnit: "%max",
        },
        {
          id: 2,
          title: "Bench Press",
          reps: 5,
          primaryUnit: "reps",
          weight: 135,
          secondaryUnit: "lb",
        },
      ],
    },
  ];

  it("re-saves by id a row whose %max load the insert stored as pounds", async () => {
    const exercisePayloads = percentLoadBackend(true);

    const result = await buildSession(new TrainHeroicClient("a@b.com", "pw"), {
      programId: 5,
      index,
      date: [2026, 6, 22],
      blocks: percentSquatBlocks,
    });

    expect(exercisePayloads).toHaveLength(2);
    expect(exercisePayloads[0]?.map((row) => row.param_2_type)).toEqual([2, 1]);
    expect(exercisePayloads[1]).toEqual([
      expect.objectContaining({ id: 900, title: "Back Squat", param_2_type: 2, order: 1 }),
    ]);
    expect(result.advisories.notes[0]).toMatch(/Back Squat: secondary values are in %max/u);
  });

  it("names an untitled exercise by the title TrainHeroic stored when units do not stick", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/createWorkoutForDay/")) return json({ workout_id: 10, id: 20 });
        if (url.includes("/saveProgramWorkoutSets")) return json([{ order: 1, id: 101 }]);
        if (url.includes("/saveWorkoutSetExercises")) {
          const rows = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
          return json(
            rows.map((row) => ({ ...row, id: 900, title: "Back Squat", param_2_type: 1 })),
          );
        }
        return json({});
      }),
    );

    await expect(
      buildSession(new TrainHeroicClient("a@b.com", "pw"), {
        programId: 5,
        index,
        date: [2026, 6, 22],
        blocks: [
          {
            title: "Squat",
            exercises: [{ id: 1, reps: 5, primaryUnit: "reps", weight: 70, secondaryUnit: "%max" }],
          },
        ],
      }),
    ).rejects.toThrow(/requested units for Back Squat on draft session 20/u);
  });

  it.each([
    { name: "is not a row array", body: { success: 1 }, expected: /unexpected response shape/u },
    {
      name: "has no row for a sent exercise",
      body: [{ id: 900, order: 1, exercise_id: 99, param_1_type: 3, param_2_type: 1 }],
      expected: /no row for exercise 1 \(order 1\)/u,
    },
  ])("fails when the exercise save response $name", async ({ body, expected }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/createWorkoutForDay/")) return json({ workout_id: 10, id: 20 });
        if (url.includes("/saveProgramWorkoutSets")) return json([{ order: 1, id: 101 }]);
        if (url.includes("/saveWorkoutSetExercises")) return json(body);
        return json({});
      }),
    );

    await expect(
      buildSession(new TrainHeroicClient("a@b.com", "pw"), {
        programId: 5,
        index,
        date: [2026, 6, 22],
        blocks: [{ title: "Squat", exercises: [{ id: 1, reps: 5, primaryUnit: "reps" }] }],
      }),
    ).rejects.toThrow(expected);
  });

  it("fails when TrainHeroic does not keep the re-saved types", async () => {
    percentLoadBackend(false);

    await expect(
      buildSession(new TrainHeroicClient("a@b.com", "pw"), {
        programId: 5,
        index,
        date: [2026, 6, 22],
        blocks: percentSquatBlocks,
      }),
    ).rejects.toThrow(/did not keep the requested units for Back Squat on draft session 20/u);
  });

  it("runs create -> blocks -> exercises with a global key counter and per-block set ids", async () => {
    const exercisePayloads: unknown[][] = [];
    let publishCalled = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/createWorkoutForDay/")) return json({ workout_id: 10, id: 20 });
        if (url.includes("/saveProgramWorkoutSets")) {
          return json([
            { order: 1, id: 101 },
            { order: 2, id: 102 },
          ]);
        }
        if (url.includes("/saveWorkoutSetExercises")) {
          exercisePayloads.push(JSON.parse(String(init?.body)) as unknown[]);
          return echoRows(init);
        }
        if (url.includes("/programWorkout/publish")) {
          publishCalled = true;
          return json({ success: 1 });
        }
        return json({});
      }),
    );

    const client = new TrainHeroicClient("a@b.com", "pw");
    const result = await buildSession(client, {
      programId: 5,
      index,
      date: [2026, 6, 22],
      publish: false,
      blocks: [
        { title: "A", exercises: [{ id: 1, reps: [5], primaryUnit: "reps" }] },
        { title: "B", exercises: [{ id: 2, reps: [3], primaryUnit: "reps" }] },
      ],
    });

    expect(result).toEqual({ pwId: 20, workoutId: 10, advisories: { notes: [], warnings: [] } });
    expect(publishCalled).toBe(false);
    expect(exercisePayloads).toHaveLength(2);

    const first = exercisePayloads[0]?.[0] as Record<string, unknown>;
    const second = exercisePayloads[1]?.[0] as Record<string, unknown>;
    expect(first.workout_set_id).toBe(101);
    expect(first.key).toBe("k::10001");
    expect(first.param_1_data_1).toBe("5");
    expect(second.workout_set_id).toBe(102);
    expect(second.key).toBe("k::10002");
  });

  it("requires explicit confirmation before splitting more than ten sets", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      buildSession(new TrainHeroicClient("a@b.com", "pw"), {
        programId: 5,
        index,
        date: [2026, 6, 22],
        blocks: [
          { title: "Squat", exercises: [{ id: 1, sets: 11, reps: 5, primaryUnit: "reps" }] },
        ],
      }),
    ).rejects.toThrow(/confirmSetSplit:true/iu);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves confirmed oversized prescriptions as consecutive blocks of at most ten sets", async () => {
    let blockPayload: Array<Record<string, unknown>> = [];
    const exercisePayloads: unknown[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/createWorkoutForDay/")) return json({ workout_id: 10, id: 20 });
        if (url.includes("/saveProgramWorkoutSets")) {
          blockPayload = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
          return json([
            { order: 1, id: 101 },
            { order: 2, id: 102 },
          ]);
        }
        if (url.includes("/saveWorkoutSetExercises")) {
          exercisePayloads.push(JSON.parse(String(init?.body)) as unknown[]);
          return echoRows(init);
        }
        return json({});
      }),
    );

    await buildSession(new TrainHeroicClient("a@b.com", "pw"), {
      programId: 5,
      index,
      date: [2026, 6, 22],
      confirmSetSplit: true,
      blocks: [
        {
          title: "Squat",
          exercises: [
            {
              id: 1,
              reps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
              primaryUnit: "reps",
              weight: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111],
              secondaryUnit: "lb",
            },
          ],
        },
      ],
    });

    expect(blockPayload.map((block) => block.title)).toEqual(["Squat", "Squat"]);
    const first = exercisePayloads[0]?.[0] as Record<string, unknown>;
    const second = exercisePayloads[1]?.[0] as Record<string, unknown>;
    expect(first.set_num).toBe(10);
    expect(first.param_1_data_10).toBe("10");
    expect(first.param_2_data_10).toBe("110");
    expect(second.set_num).toBe(1);
    expect(second.param_1_data_1).toBe("11");
    expect(second.param_2_data_1).toBe("111");
  });

  it("bounds concurrent exercise-save requests across many blocks", async () => {
    let active = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/createWorkoutForDay/")) return json({ workout_id: 10, id: 20 });
        if (url.includes("/saveProgramWorkoutSets")) {
          const blocks = JSON.parse(String(init?.body)) as Array<{ order: number }>;
          return json(blocks.map(({ order }) => ({ order, id: 100 + order })));
        }
        if (url.includes("/saveWorkoutSetExercises")) {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => {
            setTimeout(resolve, 5);
          });
          active -= 1;
          return echoRows(init);
        }
        return json({});
      }),
    );

    await buildSession(new TrainHeroicClient("a@b.com", "pw"), {
      programId: 5,
      index,
      date: [2026, 6, 22],
      blocks: Array.from({ length: 10 }, (_, position) => ({
        title: `Block ${position + 1}`,
        exercises: [{ id: position + 1, reps: [5], primaryUnit: "reps" }],
      })),
    });

    expect(peak).toBeLessThanOrEqual(4);
  });

  it("publishes when requested", async () => {
    let publishBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/createWorkoutForDay/")) return json({ workout_id: 10, id: 20 });
        if (url.includes("/saveProgramWorkoutSets")) return json([{ order: 1, id: 101 }]);
        if (url.includes("/saveWorkoutSetExercises")) return echoRows(init);
        if (url.includes("/programWorkout/publish")) {
          publishBody = JSON.parse(String(init?.body));
          return json({ success: 1 });
        }
        return json({});
      }),
    );

    const client = new TrainHeroicClient("a@b.com", "pw");
    await buildSession(client, {
      programId: 5,
      index,
      date: [2026, 6, 22],
      publish: true,
      blocks: [{ title: "A", exercises: [{ id: 1, reps: [5], primaryUnit: "reps" }] }],
    });

    expect(publishBody).toEqual([20]);
  });

  it("sets the session note via PUT before publish, without changing publish state", async () => {
    let putUrl = "";
    let putBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/createWorkoutForDay/"))
          return json({ workout_id: 10, id: 20, program_id: 5, published: null });
        if (url.includes("/saveProgramWorkoutSets")) {
          return json([
            { order: 1, id: 101 },
            { order: 2, id: 102 },
          ]);
        }
        if (url.includes("/saveWorkoutSetExercises")) return echoRows(init);
        if (url.includes("/3.0/coach/workout/")) {
          putUrl = url;
          putBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return json({ success: 1 });
        }
        return json({});
      }),
    );

    await buildSession(new TrainHeroicClient("a@b.com", "pw"), {
      programId: 5,
      index,
      date: [2026, 6, 22],
      publish: false,
      instruction: "Welcome to Week 12",
      blocks: [
        { title: "A", exercises: [{ id: 1, reps: [5], primaryUnit: "reps" }] },
        { title: "B", exercises: [{ id: 2, reps: [3], primaryUnit: "reps" }] },
      ],
    });

    expect(putUrl).toContain("/3.0/coach/workout/10");
    expect(putBody?.instruction).toBe("Welcome to Week 12");
    expect(putBody?.sets).toEqual([101, 102]);
    expect(putBody?.setKeys).toEqual([101, 102]);
    expect(putBody?.published).toBe(null);
  });

  it("saves a text-only Circuit block without posting empty saveWorkoutSetExercises", async () => {
    const exercisePosts: unknown[] = [];
    let blockPayload: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/createWorkoutForDay/")) return json({ workout_id: 10, id: 20 });
        if (url.includes("/saveProgramWorkoutSets")) {
          blockPayload = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
          return json([{ order: 1, id: 101 }]);
        }
        if (url.includes("/saveWorkoutSetExercises")) {
          exercisePosts.push(JSON.parse(String(init?.body)));
          return echoRows(init);
        }
        return json({});
      }),
    );

    await buildSession(new TrainHeroicClient("a@b.com", "pw"), {
      programId: 5,
      index,
      date: [2026, 6, 22],
      blocks: [
        {
          title: "Prep Circuit",
          instruction: "3 rounds:\n10 air squats\n10 push-ups",
          exercises: [],
        },
      ],
    });

    expect(blockPayload[0]).toMatchObject({
      type: 1,
      instruction: "3 rounds:\n10 air squats\n10 push-ups",
      title: "Prep Circuit",
    });
    expect(exercisePosts).toEqual([]);
  });

  it("rejects a text-only block with no instruction before calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      buildSession(new TrainHeroicClient("a@b.com", "pw"), {
        programId: 5,
        index,
        date: [2026, 6, 22],
        blocks: [{ title: "Broken", exercises: [] }],
      }),
    ).rejects.toThrow(/no exercises needs a non-empty instruction/iu);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hints at athlete calendar resolution when createWorkoutForDay returns HTTP 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/createWorkoutForDay/")) return json("Server Error", 500);
        return json({});
      }),
    );

    await expect(
      buildSession(new TrainHeroicClient("a@b.com", "pw"), {
        programId: 3302593,
        index,
        date: [2026, 8, 1],
        blocks: [{ title: "A", exercises: [{ id: 1, reps: [5], primaryUnit: "reps" }] }],
      }),
    ).rejects.toThrow(/calendars\/athletes|coach-writable|programId/iu);
  });
});

describe("readSession", () => {
  it("reads back units and leaderboard even when the API returns numeric fields as strings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/1.0/coach/programs/edit/")) {
          return json({
            programWorkouts: [
              {
                id: 20,
                year: 2026,
                month: 6,
                day: 22,
                published: 1,
                sets: {
                  "1": {
                    id: 5,
                    order: 1,
                    redzone_type: "3",
                    smaller_is_better: 0,
                    title: "Primary",
                    exercises: [
                      {
                        order: 1,
                        title: "Bench",
                        param_1_type: "3",
                        param_2_type: "1",
                        param_1_data_1: "5",
                        param_2_data_1: "185",
                      },
                    ],
                  },
                },
              },
            ],
          });
        }
        return json({});
      }),
    );
    const res = await readSession(new TrainHeroicClient("a@b.com", "pw"), 5, [2026, 6, 22], 20);
    expect(res.blocks[0]?.leaderboard).toContain("ROUNDS");
    expect(res.blocks[0]?.exercises[0]?.primaryUnit).toBe("reps");
    expect(res.blocks[0]?.exercises[0]?.loadUnit).toBe("lb");
  });

  it("keeps reps and load slot-aligned and zero-pads the date on read-back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/1.0/coach/programs/edit/")) {
          return json({
            programWorkouts: [
              {
                id: 21,
                year: 2026,
                month: 6,
                day: 2,
                published: 0,
                sets: {
                  "1": {
                    id: 5,
                    order: 1,
                    title: "Primary",
                    exercises: [
                      {
                        id: 9,
                        order: 1,
                        title: "Bench",
                        // Set 2 is reps-only, set 4 is load-only ("work up to 225").
                        param_1_data_1: "5",
                        param_2_data_1: "185",
                        param_1_data_2: "5",
                        param_1_data_3: "5",
                        param_2_data_3: "205",
                        param_2_data_4: "225",
                      },
                      {
                        id: 10,
                        order: 2,
                        title: "Row",
                        param_1_data_1: "10",
                        param_1_data_2: "10",
                      },
                    ],
                  },
                },
              },
            ],
          });
        }
        return json({});
      }),
    );
    const res = await readSession(new TrainHeroicClient("a@b.com", "pw"), 5, [2026, 6, 2], 21);
    expect(res.date).toBe("2026-06-02");
    const bench = res.blocks[0]?.exercises[0];
    expect(bench?.reps).toEqual(["5", "5", "5", ""]);
    expect(bench?.load).toEqual(["185", "", "205", "225"]);
    const row = res.blocks[0]?.exercises[1];
    expect(row?.reps).toEqual(["10", "10"]);
    expect(row?.load).toEqual([]);
  });

  it("includes block-level instruction on read-back (Circuit free-text)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/1.0/coach/programs/edit/")) {
          return json({
            programWorkouts: [
              {
                id: 20,
                year: 2026,
                month: 6,
                day: 22,
                published: 0,
                sets: {
                  "1": {
                    id: 5,
                    order: 1,
                    title: "Prep Circuit",
                    instruction: "3 rounds for quality",
                    // Live coach edit-GET returns a null-id UI placeholder on text-only blocks.
                    exercises: [
                      {
                        exercise_id: null,
                        id: null,
                        instruction: null,
                        order: null,
                        title: null,
                      },
                    ],
                  },
                },
              },
            ],
          });
        }
        return json({});
      }),
    );
    const res = await readSession(new TrainHeroicClient("a@b.com", "pw"), 5, [2026, 6, 22], 20);
    expect(res.blocks[0]).toMatchObject({
      title: "Prep Circuit",
      instruction: "3 rounds for quality",
      exercises: [],
    });
  });
});
