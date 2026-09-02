import { afterEach, describe, expect, it, vi } from "vitest";
import {
  logAdHocSession,
  logSessionForAthlete,
  removePersonalWorkout,
} from "../src/athlete-set-write";
import { TrainHeroicClient } from "../src/client";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const SET_ID = 5000;
const SET_ID_2 = 5001;
const SWE_ID = 6000;
const SWE_ID_2 = 6001;
const WSE_ID = 7000;
const WSE_ID_2 = 7001;
const SAVED_ID = 8000;
const WORKOUT_ID = 9000;
const EXERCISE_ID = 1;

/** One program-workout for the day, carrying the saved set the log write resolves against. */
function dayWithSet(personal: boolean) {
  return [
    {
      id: 12345,
      date: "2026-06-21",
      personal_cal: personal,
      workout_id: WORKOUT_ID,
      summarizedSavedWorkout: {
        saved_workout: {
          id: SAVED_ID,
          workoutSets: [
            {
              id: SET_ID,
              workout_set_id: 4444,
              saved_workout_id: SAVED_ID,
              unit: "lb",
              workoutSetExercises: [
                {
                  id: SWE_ID,
                  workout_set_exercise_id: WSE_ID,
                  exercise_id: EXERCISE_ID,
                  exercise_title: "Back Squat",
                },
              ],
            },
            {
              id: SET_ID_2,
              workout_set_id: 4445,
              saved_workout_id: SAVED_ID,
              unit: "lb",
              workoutSetExercises: [
                {
                  id: SWE_ID_2,
                  workout_set_exercise_id: WSE_ID_2,
                  exercise_id: 2,
                  exercise_title: "Bench Press",
                },
              ],
            },
          ],
        },
      },
    },
  ];
}

const ADD_RESPONSE = [
  { id: SET_ID, savedWorkoutSetExercises: [{ id: SWE_ID, exerciseId: EXERCISE_ID }] },
  { id: SET_ID_2, savedWorkoutSetExercises: [{ id: SWE_ID_2, exerciseId: 2 }] },
];

describe("logAdHocSession (athlete)", () => {
  it("creates a personal session when the day has none, then logs the sets", async () => {
    let rangeCalls = 0;
    let created = false;
    const puts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/athlete/programworkout/range")) {
          rangeCalls += 1;
          // First read (find-or-create) sees an empty day; later reads (the log write) see the set.
          return json(rangeCalls === 1 ? [] : dayWithSet(true));
        }
        if (url.includes("/v5/programWorkouts/personal")) {
          created = true;
          return json({
            programWorkout: { id: 111, workoutId: WORKOUT_ID, date: "2026-06-21" },
            savedWorkout: { id: SAVED_ID, group_id: 222 },
          });
        }
        if (url.includes("/addExercises")) return json(ADD_RESPONSE);
        if (init?.method === "PUT") {
          puts.push(url);
          return json({ ok: 1 });
        }
        return json({});
      }),
    );

    const result = await logAdHocSession(new TrainHeroicClient("a@b.com", "pw"), {
      date: "2026-06-21",
      exercises: [
        { exerciseId: EXERCISE_ID, sets: [{ param1: 5, param2: 185 }] },
        { exerciseId: 2, sets: [{ param1: 5, param2: 135 }] },
      ],
    });

    expect(created).toBe(true);
    expect(result.created).toBe(true);
    expect(rangeCalls).toBe(2);
    expect(result.sets).toEqual([
      { savedWorkoutSetId: SET_ID, exercisesLogged: 1 },
      { savedWorkoutSetId: SET_ID_2, exercisesLogged: 1 },
    ]);
    expect(puts.some((u) => u.includes(`/savedworkoutsetexercise/${SWE_ID}`))).toBe(true);
    expect(puts.some((u) => u.includes(`/savedworkoutset/${SET_ID}`))).toBe(true);
  });

  it("reuses an existing personal session (append) instead of creating one", async () => {
    let created = false;
    let rangeCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/athlete/programworkout/range")) {
          rangeCalls += 1;
          return json(dayWithSet(true));
        }
        if (url.includes("/v5/programWorkouts/personal")) {
          created = true;
          return json({ programWorkout: {}, savedWorkout: {} });
        }
        if (url.includes("/addExercises")) return json(ADD_RESPONSE);
        if (init?.method === "PUT") return json({ ok: 1 });
        return json({});
      }),
    );

    const result = await logAdHocSession(new TrainHeroicClient("a@b.com", "pw"), {
      date: "2026-06-21",
      exercises: [{ exerciseId: EXERCISE_ID, sets: [{ param1: 5, param2: 185 }] }],
    });

    expect(created).toBe(false);
    expect(result.created).toBe(false);
    expect(rangeCalls).toBeGreaterThan(0);
    expect(result.sets).toEqual([{ savedWorkoutSetId: SET_ID, exercisesLogged: 1 }]);
    // The match is on a personal session, not a coach-scheduled one, so it is not an alternative.
    expect(result.scheduledAlternatives).toBeUndefined();
  });

  it("flags a coach-scheduled workout that day matching the logged exercise (warn, not redirect)", async () => {
    let created = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        // A non-personal (coach-scheduled) workout carrying the same exercise that day.
        if (url.includes("/athlete/programworkout/range")) return json(dayWithSet(false));
        if (url.includes("/v5/programWorkouts/personal")) {
          created = true;
          return json({
            programWorkout: { id: 111, workoutId: WORKOUT_ID, date: "2026-06-21" },
            savedWorkout: { id: SAVED_ID, group_id: 222 },
          });
        }
        if (url.includes("/addExercises")) return json(ADD_RESPONSE);
        if (init?.method === "PUT") return json({ ok: 1 });
        return json({});
      }),
    );

    const result = await logAdHocSession(new TrainHeroicClient("a@b.com", "pw"), {
      date: "2026-06-21",
      exercises: [{ exerciseId: EXERCISE_ID, sets: [{ param1: 5, param2: 185 }] }],
    });

    // The ad-hoc log still ran into a personal session...
    expect(created).toBe(true);
    expect(result.sets).toEqual([{ savedWorkoutSetId: SET_ID, exercisesLogged: 1 }]);
    // ...but the scheduled match is surfaced so a caller can point at athlete_log_set.
    expect(result.scheduledAlternatives?.length).toBe(1);
    expect(result.scheduledAlternatives?.[0]).toMatchObject({
      exerciseId: EXERCISE_ID,
      savedWorkoutSetId: SET_ID,
      savedWorkoutSetExerciseId: SWE_ID,
    });
  });
});

describe("removePersonalWorkout", () => {
  // dayWithSet's program workout id is 12345; personal_cal toggles whether it is a personal session.
  const DAY_ID = 12345;

  /** Stub the range read (returns the day) + capture any DELETE. */
  function stub(personal: boolean, deleteStatus = 200) {
    let method = "";
    let deletedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/athlete/programworkout/range")) return json(dayWithSet(personal));
        if (init?.method === "DELETE") {
          method = "DELETE";
          deletedUrl = url;
          return json(deleteStatus === 200 ? { success: true } : { error: "nope" }, deleteStatus);
        }
        return json({});
      }),
    );
    return {
      get method() {
        return method;
      },
      get deletedUrl() {
        return deletedUrl;
      },
    };
  }

  it("re-reads the day and DELETEs a personal session by id", async () => {
    const calls = stub(true);
    await removePersonalWorkout(new TrainHeroicClient("a@b.com", "pw"), {
      programWorkoutId: DAY_ID,
      date: "2026-06-21",
    });
    expect(calls.method).toBe("DELETE");
    expect(calls.deletedUrl).toContain(`/v5/programWorkouts/${DAY_ID}`);
  });

  it("refuses a coach-scheduled workout (no DELETE fired)", async () => {
    const calls = stub(false);
    await expect(
      removePersonalWorkout(new TrainHeroicClient("a@b.com", "pw"), {
        programWorkoutId: DAY_ID,
        date: "2026-06-21",
      }),
    ).rejects.toThrow(/coach-scheduled workout/u);
    expect(calls.method).toBe("");
  });

  it("throws when no workout with that id is on the day", async () => {
    stub(true);
    await expect(
      removePersonalWorkout(new TrainHeroicClient("a@b.com", "pw"), {
        programWorkoutId: 99999,
        date: "2026-06-21",
      }),
    ).rejects.toThrow(/No workout with id 99999/u);
  });

  it("throws on a non-ok DELETE response", async () => {
    stub(true, 500);
    await expect(
      removePersonalWorkout(new TrainHeroicClient("a@b.com", "pw"), {
        programWorkoutId: DAY_ID,
        date: "2026-06-21",
      }),
    ).rejects.toThrow(/Remove personal workout failed/u);
  });
});

describe("logSessionForAthlete (coach)", () => {
  it("logs against a prescribed set the athlete already has", async () => {
    const puts: string[] = [];
    let rangeCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/coach/athlete/programworkout/range")) {
          rangeCalls += 1;
          return json(dayWithSet(false));
        }
        if (init?.method === "PUT") {
          puts.push(url);
          return json({ ok: 1 });
        }
        return json({});
      }),
    );

    const result = await logSessionForAthlete(new TrainHeroicClient("a@b.com", "pw"), {
      athleteId: 333,
      date: "2026-06-21",
      exercises: [
        { exerciseId: EXERCISE_ID, sets: [{ param1: 5, param2: 185 }] },
        { exerciseId: 2, sets: [{ param1: 5, param2: 135 }] },
      ],
    });

    expect(result.created).toBe(false);
    expect(rangeCalls).toBe(1);
    expect(result.sets).toEqual([
      { savedWorkoutSetId: SET_ID, exercisesLogged: 1 },
      { savedWorkoutSetId: SET_ID_2, exercisesLogged: 1 },
    ]);
    // Coach surface stamps the athleteId into the path.
    expect(puts.some((u) => u.includes(`/coach/savedworkoutsetexercise/${SWE_ID}/333`))).toBe(true);
  });

  it("fails with a helpful error when the exercise is not prescribed that day", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/auth") ? json({ id: 1, session_id: "s" }) : json(dayWithSet(false)),
      ),
    );

    await expect(
      logSessionForAthlete(new TrainHeroicClient("a@b.com", "pw"), {
        athleteId: 333,
        date: "2026-06-21",
        exercises: [{ exerciseId: 999, sets: [{ param1: 5 }] }],
      }),
    ).rejects.toThrow(/not on athlete 333's calendar/u);
  });

  it("validates every set before writing any part of the session", async () => {
    const day = dayWithSet(false);
    Reflect.deleteProperty(
      day[0]!.summarizedSavedWorkout.saved_workout.workoutSets[1]!.workoutSetExercises[0]!,
      "workout_set_exercise_id",
    );
    const puts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/coach/athlete/programworkout/range")) return json(day);
        if (init?.method === "PUT") puts.push(url);
        return json({ ok: 1 });
      }),
    );

    await expect(
      logSessionForAthlete(new TrainHeroicClient("a@b.com", "pw"), {
        athleteId: 333,
        date: "2026-06-21",
        exercises: [
          { exerciseId: EXERCISE_ID, sets: [{ param1: 5 }] },
          { exerciseId: 2, sets: [{ param1: 5 }] },
        ],
      }),
    ).rejects.toThrow(/missing its workout_set_exercise_id/u);
    expect(puts).toEqual([]);
  });

  it("recommends retrying partial writes against an existing prescribed set", async () => {
    const day = dayWithSet(false);
    day[0]!.summarizedSavedWorkout.saved_workout.workoutSets[0]!.workoutSetExercises.push({
      id: SWE_ID_2,
      workout_set_exercise_id: WSE_ID_2,
      exercise_id: 2,
      exercise_title: "Bench Press",
    });
    const responses = new Map<number, ReturnType<typeof deferred<Response>>>();
    const started = deferred<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/coach/athlete/programworkout/range")) return json(day);
        if (init?.method === "PUT") {
          const match = /savedworkoutsetexercise\/(\d+)/u.exec(url);
          if (!match) return json({ ok: 1 });
          const id = Number(match[1]);
          const response = deferred<Response>();
          responses.set(id, response);
          if (responses.size === 2) started.resolve();
          return response.promise;
        }
        return json({});
      }),
    );

    const run = logSessionForAthlete(new TrainHeroicClient("a@b.com", "pw"), {
      athleteId: 333,
      date: "2026-06-21",
      exercises: [
        { exerciseId: EXERCISE_ID, sets: [{ param1: 5 }] },
        { exerciseId: 2, sets: [{ param1: 5 }] },
      ],
    });
    await started.promise;
    responses.get(SWE_ID)!.resolve(json({}, 500));
    responses.get(SWE_ID_2)!.resolve(json({ ok: 1 }));

    await expect(run).rejects.toThrow(
      /Confirmed exercise writes in incomplete sets before the failure: set 5000: 6001\. Retry the same request to reconcile them\./u,
    );
  });
});

describe("logAdHocSession write concurrency", () => {
  it("keeps the whole session under one in-flight ceiling across sets", async () => {
    // Six personal sets, one exercise each: the per-set pool and the per-exercise pool nest.
    const setIds = [5100, 5101, 5102, 5103, 5104, 5105];
    const day = [
      {
        id: 12345,
        date: "2026-06-21",
        personal_cal: true,
        workout_id: WORKOUT_ID,
        summarizedSavedWorkout: {
          saved_workout: {
            id: SAVED_ID,
            workoutSets: setIds.map((id, k) => ({
              id,
              workout_set_id: 4000 + k,
              saved_workout_id: SAVED_ID,
              unit: "lb",
              workoutSetExercises: [
                {
                  id: 6100 + k,
                  workout_set_exercise_id: 7100 + k,
                  exercise_id: 10 + k,
                  exercise_title: `Lift ${k}`,
                },
              ],
            })),
          },
        },
      },
    ];
    const added = setIds.map((id, k) => ({
      id,
      savedWorkoutSetExercises: [{ id: 6100 + k, exerciseId: 10 + k }],
    }));
    let inFlight = 0;
    let peak = 0;
    let puts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/athlete/programworkout/range")) return json(day);
        if (url.includes("/addExercises")) return json(added);
        if (init?.method === "PUT") {
          puts += 1;
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 3);
          });
          inFlight -= 1;
          return json({ ok: 1 });
        }
        return json({});
      }),
    );
    const result = await logAdHocSession(new TrainHeroicClient("a@b.com", "pw"), {
      date: "2026-06-21",
      exercises: setIds.map((_, k) => ({ exerciseId: 10 + k, sets: [{ param1: 5 }] })),
    });
    expect(result.sets).toHaveLength(6);
    // Six exercise PUTs plus six set-completion PUTs.
    expect(puts).toBe(12);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("reports partial writes while finalizing sibling sets after a failure", async () => {
    const setIds = [5100, 5101, 5102, 5103, 5104, 5105];
    const day = [
      {
        id: 12345,
        date: "2026-06-21",
        personal_cal: true,
        workout_id: WORKOUT_ID,
        summarizedSavedWorkout: {
          saved_workout: {
            id: SAVED_ID,
            workoutSets: setIds.map((id, k) => ({
              id,
              workout_set_id: 4000 + k,
              saved_workout_id: SAVED_ID,
              unit: "lb",
              workoutSetExercises: [
                {
                  id: 6100 + k,
                  workout_set_exercise_id: 7100 + k,
                  exercise_id: 10 + k,
                  exercise_title: `Lift ${k}`,
                },
                ...(k === 0
                  ? [
                      {
                        id: 6200,
                        workout_set_exercise_id: 7200,
                        exercise_id: 20,
                        exercise_title: "Lift 0B",
                      },
                    ]
                  : []),
              ],
            })),
          },
        },
      },
    ];
    const added = setIds.map((id, k) => ({
      id,
      savedWorkoutSetExercises: [
        { id: 6100 + k, exerciseId: 10 + k },
        ...(k === 0 ? [{ id: 6200, exerciseId: 20 }] : []),
      ],
    }));
    const puts: string[] = [];
    const exerciseResponses = new Map<number, ReturnType<typeof deferred<Response>>>();
    const initialStarted = deferred<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/athlete/programworkout/range")) return json(day);
        if (url.includes("/addExercises")) return json(added);
        if (init?.method === "PUT") {
          puts.push(url);
          const match = /savedworkoutsetexercise\/(\d+)/u.exec(url);
          if (!match) return json({ ok: 1 });
          const id = Number(match[1]);
          const response = deferred<Response>();
          exerciseResponses.set(id, response);
          if (exerciseResponses.size === 4) initialStarted.resolve();
          return response.promise;
        }
        return json({});
      }),
    );
    const run = logAdHocSession(new TrainHeroicClient("a@b.com", "pw"), {
      date: "2026-06-21",
      exercises: [
        { exerciseId: 10, sets: [{ param1: 5 }] },
        { exerciseId: 20, sets: [{ param1: 5 }] },
        ...setIds.slice(1).map((_, k) => ({ exerciseId: 11 + k, sets: [{ param1: 5 }] })),
      ],
    });
    await initialStarted.promise;
    expect([...exerciseResponses.keys()]).toEqual([6100, 6200, 6101, 6102]);

    // One exercise fails while another in the same set succeeds. Sibling sets that already started
    // still finish and are marked complete, while later queued writes are cancelled.
    exerciseResponses.get(6100)!.resolve(json({}, 500));
    exerciseResponses.get(6200)!.resolve(json({ ok: 1 }));
    exerciseResponses.get(6101)!.resolve(json({ ok: 1 }));
    exerciseResponses.get(6102)!.resolve(json({ ok: 1 }));

    await expect(run).rejects.toThrow(
      /Failed to write exercise 6100.*Confirmed exercise writes in incomplete sets before the failure: set 5100: 6200.*Set writes confirmed before the failure: 5101, 5102/u,
    );
    await expect(run).rejects.not.toThrow(/Retry the same request/u);
    expect(puts.some((url) => url.includes("/savedworkoutset/5101"))).toBe(true);
    expect(puts.some((url) => url.includes("/savedworkoutset/5102"))).toBe(true);
    expect(puts.some((url) => url.includes("/savedworkoutsetexercise/6103"))).toBe(false);
    expect(puts.some((url) => url.includes("/savedworkoutsetexercise/6105"))).toBe(false);
  });
});
