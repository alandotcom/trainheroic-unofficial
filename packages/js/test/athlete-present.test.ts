import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildExerciseLogPayload,
  buildSetCompletePayload,
  findSavedWorkoutSet,
  presentAthleteWorkout,
  presentExerciseHistory,
} from "../src/athlete";
import type { ExerciseHistoryDetail, ProgramWorkout } from "@trainheroic-unofficial/dto";

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
