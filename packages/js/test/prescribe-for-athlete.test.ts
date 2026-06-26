import { afterEach, describe, expect, it, vi } from "vitest";
import { prescribeForAthlete } from "../src/athlete-set-write";
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

const ATHLETE_ID = 2858055;
const SET_ID = 5000;
const SWE_ID = 6000;
const WSE_ID = 7000;
const SAVED_ID = 8000;

/** One coach-range program-workout carrying the saved set the prescribe write resolves against. */
function dayWithSet() {
  return [
    {
      id: 12345,
      date: "2026-06-21",
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
                  exercise_id: 1,
                  exercise_title: "Barbell Row",
                },
              ],
            },
          ],
        },
      },
    },
  ];
}

/** Stub fetch for the coach range read + capture every PUT (url + parsed body). */
function stubFetch(): { puts: Array<{ url: string; body: unknown }> } {
  const puts: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
      if (url.includes("/coach/athlete/programworkout/range")) return json(dayWithSet());
      if (init?.method === "PUT") {
        puts.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
        return json({ ok: 1 });
      }
      return json({});
    }),
  );
  return { puts };
}

describe("prescribeForAthlete", () => {
  it("writes one exercise PUT and does NOT mark the set completed", async () => {
    const { puts } = stubFetch();

    const result = await prescribeForAthlete(new TrainHeroicClient("a@b.com", "pw"), {
      athleteId: ATHLETE_ID,
      date: "2026-06-21",
      savedWorkoutSetId: SET_ID,
      results: [{ savedWorkoutSetExerciseId: SWE_ID, sets: [{ param1: 5, param2: 225 }] }],
    });

    expect(result).toEqual({ savedWorkoutSetId: SET_ID, exercisesPrescribed: 1 });
    // Exactly one PUT — the exercise data write. No second PUT to the set-completion endpoint
    // (that step is the thing that would mark the set done, which prescribing must not do).
    expect(puts).toHaveLength(1);
    expect(puts[0]?.url).toContain(`/coach/savedworkoutsetexercise/${SWE_ID}/${ATHLETE_ID}`);
    expect(puts.some((p) => p.url.includes("/savedworkoutset/"))).toBe(false);

    const body = puts[0]?.body as Record<string, unknown>;
    expect(body.completed).toBe(0);
    expect(body.param_1_made).toBe(0);
    expect(body.athleteId).toBe(ATHLETE_ID);
  });

  it("clears an omitted param slot (full-replacement semantics)", async () => {
    const { puts } = stubFetch();

    // Prescribe weight only; reps are omitted. The write replaces the slot, so the reps slot is
    // sent empty rather than left untouched — the documented footgun, pinned here.
    await prescribeForAthlete(new TrainHeroicClient("a@b.com", "pw"), {
      athleteId: ATHLETE_ID,
      date: "2026-06-21",
      savedWorkoutSetId: SET_ID,
      results: [{ savedWorkoutSetExerciseId: SWE_ID, sets: [{ param2: 135 }] }],
    });

    const body = puts[0]?.body as Record<string, unknown>;
    expect(body.param_1_data_1).toBe("");
    expect(body.param_2_data_1).toBe("135");
    expect(body.param_1_made).toBe(0);
  });
});
