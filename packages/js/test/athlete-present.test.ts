import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildExerciseLogPayload,
  buildSetCompletePayload,
  findSavedWorkoutSet,
  presentAthleteWorkout,
  presentCoachAthleteTraining,
  presentExerciseHistory,
  selectWorkouts,
  summarizeAthleteWorkouts,
} from "../src/athlete";
import type {
  AthleteWorkoutView,
  ExerciseHistoryDetail,
  ProgramWorkout,
} from "@trainheroic-unofficial/dto";

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")) as T;

describe("presentAthleteWorkout", () => {
  const view = presentAthleteWorkout(fixture<ProgramWorkout>("program-workout.json"));

  it("surfaces the top-level workout metadata", () => {
    expect(view.date).toBe("2026-06-01");
    expect(view.program).toBe("Bodybuilding 202");
    expect(view.instruction).toContain("Back Squat");
  });

  it("flattens blocks in order with positional units and prescribed sets", () => {
    expect(view.blocks.length).toBeGreaterThan(0);
    const orders = view.blocks.map((b) => b.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    const squat = view.blocks.flatMap((b) => b.exercises).find((e) => e.title === "Back Squat");
    expect(squat).toBeDefined();
    expect(squat?.units).toEqual(["reps", "lb"]);
    expect(squat?.prescribed.length).toBeGreaterThan(0);
  });

  it("marks test blocks", () => {
    const hasTest = view.blocks.some((b) => b.isTest);
    expect(typeof hasTest).toBe("boolean");
  });

  it("merges logged results onto the prescribed exercise and flags the workout as logged", () => {
    expect(view.logged).toBe(true);
    const squat = view.blocks.flatMap((b) => b.exercises).find((e) => e.title === "Back Squat");
    // The athlete's entered sets (reps @ weight), not the prescription.
    expect(squat?.performed).toEqual(["3 @ 275", "3 @ 285", "3 @ 295", "3 @ 295"]);
    // The prescription is still present alongside the logged values.
    expect(squat?.prescribed.length).toBeGreaterThan(0);
  });

  it("appends athlete-added work that has no prescription as its own block", () => {
    const bike = view.blocks.flatMap((b) => b.exercises).find((e) => e.title === "Assault Bike");
    expect(bike).toBeDefined();
    expect(bike?.prescribed).toEqual([]);
    expect(bike?.performed).toEqual(["12"]);
  });

  it("does not treat prescription pre-fill (data present, made=0) as performed", () => {
    // The saved copy carries Split Squat data identical to the prescription, but its
    // param_N_made flags are 0 — the athlete never logged it. performed must stay empty.
    const split = view.blocks
      .flatMap((b) => b.exercises)
      .find((e) => e.title === "Front Foot Elevated Split Squat");
    expect(split?.prescribed.length).toBeGreaterThan(0);
    expect(split?.performed).toEqual([]);
  });

  it("presents a personal session (saved copy only, no prescription) from logged data", () => {
    const personal = presentAthleteWorkout({
      id: 1,
      date: "2026-06-20",
      program_title: "Test Athlete",
      summarizedSavedWorkout: {
        saved_workout: {
          id: 42,
          workoutSets: [
            {
              id: 7,
              order: 1,
              title: "Personal",
              workoutSetExercises: [
                {
                  id: 70,
                  workout_set_exercise_id: 70,
                  exercise_id: 1162,
                  exercise_title: "Bench Press",
                  param_1_type: 3,
                  param_2_type: 1,
                  param_1_data_1: "5",
                  param_2_data_1: "185",
                  param_1_made: 1,
                },
              ],
            },
          ],
        },
      },
    } as unknown as ProgramWorkout);
    expect(personal.logged).toBe(true);
    const bench = personal.blocks
      .flatMap((b) => b.exercises)
      .find((e) => e.title === "Bench Press");
    expect(bench?.performed).toEqual(["5 @ 185"]);
    expect(bench?.prescribed).toEqual([]);
  });
});

describe("selectWorkouts", () => {
  const view = (date: string, logged: boolean): AthleteWorkoutView => ({
    id: Number(date.replaceAll("-", "")),
    date,
    title: date,
    program: null,
    team: null,
    instruction: null,
    logged,
    blocks: [],
  });
  const list: AthleteWorkoutView[] = [
    view("2026-06-16", false),
    view("2026-06-18", true),
    view("2026-06-20", false),
    view("2026-06-11", true),
  ];

  it("returns everything (a copy) with no options", () => {
    const out = selectWorkouts(list);
    expect(out).toHaveLength(4);
    expect(out).not.toBe(list);
  });

  it("loggedOnly keeps only workouts with logged sets", () => {
    const out = selectWorkouts(list, { loggedOnly: true });
    expect(out.map((w) => w.date)).toEqual(["2026-06-18", "2026-06-11"]);
  });

  it("limit returns the most recent N, newest first", () => {
    const out = selectWorkouts(list, { limit: 2 });
    expect(out.map((w) => w.date)).toEqual(["2026-06-20", "2026-06-18"]);
  });

  it("combines loggedOnly and limit", () => {
    const out = selectWorkouts(list, { loggedOnly: true, limit: 1 });
    expect(out.map((w) => w.date)).toEqual(["2026-06-18"]);
  });
});

describe("summarizeAthleteWorkouts", () => {
  it("projects the fixture workout to a compact header with exercise/performed counts", () => {
    const view = presentAthleteWorkout(fixture<ProgramWorkout>("program-workout.json"));
    const [row] = summarizeAthleteWorkouts([view]);
    expect(row).toBeDefined();
    if (!row) return;
    expect(row.date).toBe(view.date);
    expect(row.title).toBe(view.title);
    expect(row.program).toBe(view.program);
    expect(row.logged).toBe(view.logged);
    // Counts mirror the flattened view; performed never exceeds total exercises.
    const totalExercises = view.blocks.reduce((n, b) => n + b.exercises.length, 0);
    const performed = view.blocks.reduce(
      (n, b) => n + b.exercises.filter((e) => e.performed.length > 0).length,
      0,
    );
    expect(row.exerciseCount).toBe(totalExercises);
    expect(row.performedCount).toBe(performed);
    expect(row.performedCount).toBeLessThanOrEqual(row.exerciseCount);
    // The summary carries no block/exercise detail.
    expect(row).not.toHaveProperty("blocks");
  });

  it("counts only exercises with a performed set", () => {
    const view: AthleteWorkoutView = {
      id: 1,
      date: "2026-06-18",
      title: "Mixed",
      program: "BB202",
      team: null,
      instruction: null,
      logged: true,
      blocks: [
        {
          order: 1,
          title: null,
          instruction: null,
          isTest: false,
          exercises: [
            {
              exerciseId: 1,
              title: "Bench",
              instruction: null,
              units: [],
              prescribed: ["4 @ 225"],
              performed: ["4 @ 225"],
            },
            {
              exerciseId: 2,
              title: "Fly",
              instruction: null,
              units: [],
              prescribed: ["12"],
              performed: [],
            },
          ],
        },
      ],
    };
    const [row] = summarizeAthleteWorkouts([view]);
    expect(row?.exerciseCount).toBe(2);
    expect(row?.performedCount).toBe(1);
  });
});

describe("presentCoachAthleteTraining", () => {
  const raw = fixture<unknown[]>("coach-athlete-summary.json");
  const view = presentCoachAthleteTraining(raw, 2855688, 2026, 6);

  it("carries the athlete + month and one row per session", () => {
    expect(view.athleteId).toBe(2855688);
    expect(view.athleteName).toBe("[Demo] Kyle Jones");
    expect(view.year).toBe(2026);
    expect(view.month).toBe(6);
    expect(view.sessions).toHaveLength(2);
  });

  it("flattens exercises with the API set summary and the logged flag", () => {
    const lift = view.sessions[0];
    expect(lift?.title).toBe("Lift 1 - Clean Focus");
    expect(lift?.logged).toBe(true);
    expect(lift?.rpe).toBe(5);
    expect(lift?.durationMin).toBe(80);
    const clean = lift?.exercises.find((e) => e.title === "Clean & Jerk");
    expect(clean?.exerciseId).toBe(408);
    expect(clean?.summary).toBe("5 x 2 @ 205 lb");
    expect(clean?.completed).toBe(true);
  });

  it("marks a rest/unlogged session as not logged", () => {
    const rest = view.sessions[1];
    expect(rest?.title).toBe("Rest Day");
    expect(rest?.logged).toBe(false);
    expect(rest?.rpe).toBeNull();
  });
});

describe("presentExerciseHistory", () => {
  const presented = presentExerciseHistory(
    fixture<ExerciseHistoryDetail>("exercise-history-detail.json"),
  );

  it("tidies PRs and the session time-series", () => {
    expect(presented.liftPRs.length).toBeGreaterThan(0);
    expect(presented.liftPRs[0]?.description).toBeTypeOf("string");
    expect(presented.sessions.length).toBeGreaterThan(0);
    expect(presented.sessions[0]?.date).toBeTypeOf("string");
  });
});

describe("buildExerciseLogPayload", () => {
  it("fills entered results into the per-exercise PUT body", () => {
    // savedWorkoutSetExerciseId=1863781876, savedWorkoutSetId=111, workoutSetExerciseId=739137899
    const body = buildExerciseLogPayload(1863781876, 111, 739137899, [{ param1: 5, param2: 185 }]);
    expect(body.id).toBe(1863781876);
    expect(body.saved_workout_set_id).toBe(111);
    expect(body.workout_set_exercise_id).toBe(739137899);
    expect(body.completed).toBe(1);
    expect(body.param_1_made).toBe(1);
    expect(body.param_1_data_1).toBe("5");
    expect(body.param_2_data_1).toBe("185");
  });

  it("marks completed=0 when all result slots are empty", () => {
    const body = buildExerciseLogPayload(1, 2, 3, [{}]);
    expect(body.completed).toBe(0);
    expect(body.param_1_made).toBe(0);
    expect(body.param_1_data_1).toBe("");
    expect(body.param_2_data_1).toBe("");
  });

  it("emits all 10 slots; unfilled ones get empty strings and made=0", () => {
    const body = buildExerciseLogPayload(1, 2, 3, [{ param1: 3, param2: 95 }]);
    // First slot filled
    expect(body.param_1_made).toBe(1);
    expect(body.param_1_data_1).toBe("3");
    expect(body.param_2_data_1).toBe("95");
    // Remaining slots empty
    for (let i = 2; i <= 10; i += 1) {
      expect(body[`param_${i}_made`]).toBe(0);
      expect(body[`param_1_data_${i}`]).toBe("");
      expect(body[`param_2_data_${i}`]).toBe("");
    }
  });

  it("throws when more than 10 sets are provided", () => {
    const sets = Array.from({ length: 11 }, () => ({ param1: 5 }));
    expect(() => buildExerciseLogPayload(1, 2, 3, sets)).toThrow(/at most 10/iu);
  });

  it("coerces numeric param values to strings", () => {
    const body = buildExerciseLogPayload(1, 2, 3, [{ param1: 8, param2: 225 }]);
    expect(body.param_1_data_1).toBe("8");
    expect(body.param_2_data_1).toBe("225");
  });
});

describe("findSavedWorkoutSet", () => {
  // Minimal fixture: one program workout with one saved_workout containing two sets.
  const makeWorkouts = (): ProgramWorkout[] =>
    [
      {
        summarizedSavedWorkout: {
          saved_workout: {
            id: 999,
            workoutSets: [
              {
                id: 111,
                workoutSetExercises: [{ id: 1863781876, workout_set_exercise_id: 739137899 }],
              },
              { id: 222, workoutSetExercises: [] },
            ],
          },
        },
      },
    ] as unknown as ProgramWorkout[];

  it("returns savedWorkoutId, exercises, and rawSet for a matching set", () => {
    const { savedWorkoutId, exercises, rawSet } = findSavedWorkoutSet(makeWorkouts(), 111);
    expect(savedWorkoutId).toBe(999);
    expect(exercises).toHaveLength(1);
    expect((exercises[0] as Record<string, unknown>).id).toBe(1863781876);
    expect((rawSet as Record<string, unknown>).id).toBe(111);
  });

  it("throws when the set id is not found", () => {
    expect(() => findSavedWorkoutSet(makeWorkouts(), 9999)).toThrow(/not found/u);
  });
});

describe("buildSetCompletePayload", () => {
  const baseSet: Record<string, unknown> = {
    id: 1569376139,
    saved_workout_id: 343271158,
    workout_set_id: 702186259,
    version: 6,
    rx: 1,
    is_super_set: 0,
    plain_text: 0,
    unit: "lb",
    title: "STRENGTH (2-3min rest)",
    instruction: "",
    notes: null,
  };

  it("builds a complete body with completed='1' when complete=true", () => {
    const body = buildSetCompletePayload(baseSet, [2669767113], true);
    expect(body.id).toBe(1569376139);
    expect(body.sessionId).toBe(343271158);
    expect(body.workoutSetId).toBe(702186259);
    expect(body.completed).toBe("1");
    expect(body.rx).toBe(1);
    expect(body.version).toBe(6);
    expect(body.isMetric).toBe(false);
    expect(body.isSuperSet).toBe(false);
    expect(body.isPlainText).toBe(false);
    expect(body.title).toBe("STRENGTH (2-3min rest)");
    expect(body.exercises).toEqual([2669767113]);
  });

  it("builds a body with completed='0' when complete=false", () => {
    const body = buildSetCompletePayload(baseSet, [2669767113], false);
    expect(body.completed).toBe("0");
  });

  it("sets isMetric=true when unit is 'kg'", () => {
    const body = buildSetCompletePayload({ ...baseSet, unit: "kg" }, [], true);
    expect(body.isMetric).toBe(true);
  });

  it("sets isSuperSet=true when is_super_set=1", () => {
    const body = buildSetCompletePayload({ ...baseSet, is_super_set: 1 }, [], true);
    expect(body.isSuperSet).toBe(true);
  });

  it("throws when required IDs are missing", () => {
    expect(() =>
      buildSetCompletePayload({ id: 0, saved_workout_id: 1, workout_set_id: 2 }, [], true),
    ).toThrow(/missing/iu);
    expect(() =>
      buildSetCompletePayload({ id: 1, saved_workout_id: 0, workout_set_id: 2 }, [], true),
    ).toThrow(/missing/iu);
  });
});
