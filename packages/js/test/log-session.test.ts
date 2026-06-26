import { afterEach, describe, expect, it, vi } from "vitest";
import { logAdHocSession, logSessionForAthlete } from "../src/athlete-set-write";
import { TrainHeroicClient } from "../src/client";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const SET_ID = 5000;
const SWE_ID = 6000;
const WSE_ID = 7000;
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
          ],
        },
      },
    },
  ];
}

const ADD_RESPONSE = [
  { id: SET_ID, savedWorkoutSetExercises: [{ id: SWE_ID, exerciseId: EXERCISE_ID }] },
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
      exercises: [{ exerciseId: EXERCISE_ID, sets: [{ param1: 5, param2: 185 }] }],
    });

    expect(created).toBe(true);
    expect(result.created).toBe(true);
    expect(result.sets).toEqual([{ savedWorkoutSetId: SET_ID, exercisesLogged: 1 }]);
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
  });
});

describe("logSessionForAthlete (coach)", () => {
  it("logs against a prescribed set the athlete already has", async () => {
    const puts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/coach/athlete/programworkout/range")) return json(dayWithSet(false));
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
      exercises: [{ exerciseId: EXERCISE_ID, sets: [{ param1: 5, param2: 185 }] }],
    });

    expect(result.created).toBe(false);
    expect(result.sets).toEqual([{ savedWorkoutSetId: SET_ID, exercisesLogged: 1 }]);
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
});
