import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "../src/client";
import { buildSession, readSession } from "../src/workout-session";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildSession", () => {
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
          return json({ success: 1 });
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
      date: [2026, 6, 22],
      publish: false,
      blocks: [
        { title: "A", exercises: [{ id: 1, reps: [5] }] },
        { title: "B", exercises: [{ id: 2, reps: [3] }] },
      ],
    });

    expect(result).toEqual({ pwId: 20, workoutId: 10 });
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

  it("publishes when requested", async () => {
    let publishBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/createWorkoutForDay/")) return json({ workout_id: 10, id: 20 });
        if (url.includes("/saveProgramWorkoutSets")) return json([{ order: 1, id: 101 }]);
        if (url.includes("/saveWorkoutSetExercises")) return json({ success: 1 });
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
      date: [2026, 6, 22],
      publish: true,
      blocks: [{ title: "A", exercises: [{ id: 1, reps: [5] }] }],
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
        if (url.includes("/saveWorkoutSetExercises")) return json({ success: 1 });
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
      date: [2026, 6, 22],
      publish: false,
      instruction: "Welcome to Week 12",
      blocks: [
        { title: "A", exercises: [{ id: 1, reps: [5] }] },
        { title: "B", exercises: [{ id: 2, reps: [3] }] },
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
          return json({ success: 1 });
        }
        return json({});
      }),
    );

    await buildSession(new TrainHeroicClient("a@b.com", "pw"), {
      programId: 5,
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
        date: [2026, 6, 22],
        blocks: [{ title: "Broken", exercises: [] }],
      }),
    ).rejects.toThrow(/no exercises needs a non-empty instruction/iu);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hints at personal_cal when createWorkoutForDay returns HTTP 500", async () => {
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
        date: [2026, 8, 1],
        blocks: [{ title: "A", exercises: [{ id: 1, reps: [5] }] }],
      }),
    ).rejects.toThrow(/personal calendar|personal_cal|Coach Plan/iu);
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
