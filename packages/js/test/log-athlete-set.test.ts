import { afterEach, describe, expect, it, vi } from "vitest";
import { logAthleteSet } from "../src/athlete-set-write";
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
const SAVED_ID = 8000;

/** One saved-copy exercise within the set, with its made flags defaulted to "not logged". */
function exercise(id: number, title: string, made: Partial<Record<number, 1>> = {}) {
  const ex: Record<string, unknown> = {
    id,
    workout_set_exercise_id: id + 1,
    exercise_id: id + 2,
    exercise_title: title,
  };
  for (let i = 1; i <= 10; i += 1) {
    ex[`param_1_data_${i}`] = "";
    ex[`param_2_data_${i}`] = "";
    ex[`param_${i}_made`] = made[i] ?? 0;
  }
  return ex;
}

/** Add prescribed reps to the saved-copy slots without marking them performed. */
function prescribeReps(ex: Record<string, unknown>, reps: readonly number[]) {
  reps.forEach((value, index) => {
    ex[`param_1_data_${index + 1}`] = String(value);
  });
  return ex;
}

/** One athlete-range program-workout carrying a single saved set with the given exercises. */
function dayWithExercises(exercises: Record<string, unknown>[]) {
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
              is_super_set: 1,
              workoutSetExercises: exercises,
            },
          ],
        },
      },
    },
  ];
}

/** Stub fetch for the athlete range read + capture every PUT (url + parsed body). */
function stubFetch(exercises: Record<string, unknown>[]): {
  puts: Array<{ url: string; body: Record<string, unknown> }>;
} {
  const puts: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
      if (url.includes("/3.0/athlete/programworkout/range"))
        return json(dayWithExercises(exercises));
      if (init?.method === "PUT") {
        puts.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
        return json({ ok: 1 });
      }
      return json({});
    }),
  );
  return { puts };
}

const client = () => new TrainHeroicClient("a@b.com", "pw");
const log = (results: Parameters<typeof logAthleteSet>[1]["results"]) =>
  logAthleteSet(client(), { date: "2026-06-21", savedWorkoutSetId: SET_ID, results });

describe("logAthleteSet superset completion (issue 25)", () => {
  it("leaves a three-slot circuit open when the current exercise logs only two slots", async () => {
    const hipThrust = prescribeReps(
      exercise(100, "Hip Thrust", { 1: 1, 2: 1, 3: 1 }),
      [15, 15, 15],
    );
    hipThrust.param_2_data_1 = "315";
    hipThrust.param_2_data_2 = "315";
    hipThrust.param_2_data_3 = "315";
    const { puts } = stubFetch([
      hipThrust,
      prescribeReps(exercise(200, "Single Leg RDL"), [20, 20, 20]),
      prescribeReps(exercise(300, "Banded Hamstring Curl"), [20, 20, 20]),
    ]);

    const result = await log([
      {
        savedWorkoutSetExerciseId: 200,
        sets: [
          { param1: 20, param2: 40 },
          { param1: 20, param2: 45 },
        ],
      },
    ]);

    const rdl = puts.find((p) => p.url.includes("/savedworkoutsetexercise/200"));
    expect(rdl?.body.param_1_made).toBe(1);
    expect(rdl?.body.param_2_made).toBe(1);
    expect(rdl?.body.param_3_made).toBe(0);
    expect(rdl?.body.param_1_data_3).toBe("");
    expect(rdl?.body.completed).toBe(0);
    expect(puts.some((p) => p.url.includes("/savedworkoutset/"))).toBe(false);
    expect(puts.some((p) => p.url.includes("/savedworkoutsetexercise/300"))).toBe(false);
    expect(result.setCompleted).toBe(false);
  });

  it("does NOT mark the block complete when only one exercise of a superset is logged", async () => {
    const { puts } = stubFetch([
      exercise(100, "Alternating DB Bench Press"),
      exercise(200, "Decline Push Up"),
      exercise(300, "Russian Twist"),
    ]);

    const result = await log([
      { savedWorkoutSetExerciseId: 100, sets: [{ param1: 20, param2: 55 }] },
    ]);

    // One exercise data PUT, and crucially no savedworkoutset PUT — leaving the siblings untouched.
    expect(puts.some((p) => p.url.includes(`/savedworkoutsetexercise/100`))).toBe(true);
    expect(puts.some((p) => p.url.includes("/savedworkoutset/"))).toBe(false);
    expect(result.setCompleted).toBe(false);
    expect(result.exercisesLogged).toBe(1);
  });

  it("marks the block complete once every exercise in it is logged", async () => {
    const { puts } = stubFetch([
      exercise(100, "Alternating DB Bench Press"),
      exercise(200, "Decline Push Up"),
      exercise(300, "Russian Twist"),
    ]);

    const result = await log([
      { savedWorkoutSetExerciseId: 100, sets: [{ param1: 20, param2: 55 }] },
      { savedWorkoutSetExerciseId: 200, sets: [{ param1: 15 }] },
      { savedWorkoutSetExerciseId: 300, sets: [{ param1: 20 }] },
    ]);

    expect(puts.filter((p) => p.url.includes("/savedworkoutsetexercise/"))).toHaveLength(3);
    const complete = puts.find((p) => p.url.includes("/savedworkoutset/"));
    expect(complete?.body.completed).toBe("1");
    expect(result.setCompleted).toBe(true);
  });

  it("completes the block when the last exercise is logged and the rest already had results", async () => {
    const { puts } = stubFetch([
      exercise(100, "Alternating DB Bench Press"),
      // Decline Push Up was logged in an earlier call (its first slot is already made).
      exercise(200, "Decline Push Up", { 1: 1 }),
    ]);

    const result = await log([
      { savedWorkoutSetExerciseId: 100, sets: [{ param1: 20, param2: 55 }] },
    ]);

    expect(puts.some((p) => p.url.includes("/savedworkoutset/"))).toBe(true);
    expect(result.setCompleted).toBe(true);
  });

  it("completes a normal single-exercise set as before", async () => {
    const { puts } = stubFetch([exercise(100, "Back Squat")]);

    const result = await log([
      { savedWorkoutSetExerciseId: 100, sets: [{ param1: 5, param2: 225 }] },
    ]);

    expect(puts.some((p) => p.url.includes("/savedworkoutset/"))).toBe(true);
    expect(result.setCompleted).toBe(true);
  });

  it("does NOT complete a set when the only logged exercise carries no data", async () => {
    // A no-data log writes the (cleared) exercise but must not fire the completion PUT — otherwise
    // an empty result would mark the set done with nothing performed.
    const { puts } = stubFetch([exercise(100, "Back Squat")]);

    const result = await log([{ savedWorkoutSetExerciseId: 100, sets: [{}] }]);

    expect(puts.some((p) => p.url.includes("/savedworkoutsetexercise/100"))).toBe(true);
    expect(puts.some((p) => p.url.includes("/savedworkoutset/"))).toBe(false);
    expect(result.setCompleted).toBe(false);
  });

  it("does NOT mark a slot performed when only the weight is entered (no reps)", async () => {
    // Entering target loads (weight in param2) with reps (param1) left blank must not flip the
    // per-row completion checkmark: a weight without reps is a target, not a performed set. The
    // weight is still written to the slot (so it shows as a target), but every param_N_made stays 0,
    // the exercise `completed` flag stays 0, and no savedworkoutset PUT fires — keeping the per-row
    // state and the block-level completion in agreement (both "not done").
    const { puts } = stubFetch([exercise(100, "Tempo Back Squat")]);

    const result = await log([
      {
        savedWorkoutSetExerciseId: 100,
        sets: [{ param2: 170 }, { param2: 180 }, { param2: 195 }, { param2: 205 }],
      },
    ]);

    const body = puts.find((p) => p.url.includes("/savedworkoutsetexercise/100"))?.body;
    // The weights persist as targets, but no slot is marked performed and the exercise isn't done.
    expect(body?.param_2_data_1).toBe("170");
    expect(body?.param_2_data_4).toBe("205");
    expect(body?.param_1_made).toBe(0);
    expect(body?.param_2_made).toBe(0);
    expect(body?.param_3_made).toBe(0);
    expect(body?.param_4_made).toBe(0);
    expect(body?.completed).toBe(0);
    // No block-completion PUT, and the reported completion matches the un-checked rows.
    expect(puts.some((p) => p.url.includes("/savedworkoutset/"))).toBe(false);
    expect(result.setCompleted).toBe(false);
    expect(result.exercisesLogged).toBe(1);
  });

  it("marks a slot performed on a reps-only log (no weight)", async () => {
    // The mirror of the weight-only case: reps alone ARE a performed set (bodyweight work, AMRAPs),
    // so the slot is made and a single-exercise set completes.
    const { puts } = stubFetch([exercise(100, "Pull Up")]);

    const result = await log([{ savedWorkoutSetExerciseId: 100, sets: [{ param1: 8 }] }]);

    const body = puts.find((p) => p.url.includes("/savedworkoutsetexercise/100"))?.body;
    expect(body?.param_1_data_1).toBe("8");
    expect(body?.param_1_made).toBe(1);
    expect(body?.completed).toBe(1);
    expect(result.setCompleted).toBe(true);
  });

  it("targets slots 4-6 and blanks the un-logged prescription slots (issue 23/26)", async () => {
    const ex = exercise(100, "Bench Press");
    [8, 5, 3, 1, 1, 1].forEach((reps, i) => {
      ex[`param_1_data_${i + 1}`] = String(reps);
    });
    const { puts } = stubFetch([ex]);

    await log([
      {
        savedWorkoutSetExerciseId: 100,
        sets: [
          { slot: 4, param1: 1, param2: 245 },
          { slot: 5, param1: 1, param2: 265 },
          { slot: 6, param1: 1, param2: 275 },
        ],
      },
    ]);

    const body = puts.find((p) => p.url.includes("/savedworkoutsetexercise/"))?.body;
    // The singles land in slots 4-6, and the un-logged leading prescription slots are blanked so
    // marking the set done won't flag them performed.
    expect(body?.param_2_data_4).toBe("245");
    expect(body?.param_4_made).toBe(1);
    expect(body?.param_2_data_6).toBe("275");
    expect(body?.param_1_data_1).toBe("");
    expect(body?.param_1_data_3).toBe("");
    expect(body?.param_1_made).toBe(0);
  });

  it("keeps an earlier-logged sibling slot when logging the rest of the set", async () => {
    const ex = exercise(100, "Bench Press", { 1: 1 });
    ex.param_1_data_1 = "5";
    ex.param_2_data_1 = "225";
    const { puts } = stubFetch([ex]);

    await log([{ savedWorkoutSetExerciseId: 100, sets: [{ slot: 2, param1: 5, param2: 225 }] }]);

    const body = puts.find((p) => p.url.includes("/savedworkoutsetexercise/"))?.body;
    // Slot 1 was already performed — it survives the write that adds slot 2.
    expect(body?.param_1_data_1).toBe("5");
    expect(body?.param_2_data_1).toBe("225");
    expect(body?.param_1_made).toBe(1);
    expect(body?.param_2_made).toBe(1);
  });
});
