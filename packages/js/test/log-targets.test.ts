import { describe, expect, it } from "vitest";
import type { ProgramWorkout } from "@trainheroic-unofficial/dto";
import { presentLogTargets, selectWorkoutsByProgram } from "../src/athlete";

// presentLogTargets is the compact, non-raw path that carries the savedWorkoutSetId +
// savedWorkoutSetExerciseId a coach needs to log/prescribe, plus the program identity so a
// high-enrollment athlete's many sessions can be told apart (issue #18).

function workout(opts: {
  programId: number;
  programTitle: string;
  teamId: number;
  savedWorkoutSetId: number;
  savedWorkoutSetExerciseId: number;
}): ProgramWorkout {
  return {
    id: opts.savedWorkoutSetId * 10,
    date: "2026-06-22",
    workout_title: `${opts.programTitle} — Day 1`,
    program_id: opts.programId,
    program_title: opts.programTitle,
    team_id: opts.teamId,
    team_title: opts.programTitle,
    summarizedSavedWorkout: {
      saved_workout: {
        id: opts.savedWorkoutSetId * 100,
        workoutSets: [
          {
            id: opts.savedWorkoutSetId,
            title: "Main",
            workoutSetExercises: [
              {
                id: opts.savedWorkoutSetExerciseId,
                exercise_id: 900001,
                exercise_title: "Back Squat",
                param_1_type: "reps",
                param_2_type: "lb",
                param_1_data_1: "5",
                param_2_data_1: "225",
              },
            ],
          },
        ],
      },
    },
  } as unknown as ProgramWorkout;
}

describe("presentLogTargets", () => {
  it("carries program identity plus the saved log ids", () => {
    const targets = presentLogTargets([
      workout({
        programId: 1643538,
        programTitle: "Powerlifting",
        teamId: 1607915,
        savedWorkoutSetId: 880006,
        savedWorkoutSetExerciseId: 770060,
      }),
    ]);
    expect(targets).toHaveLength(1);
    const t = targets[0];
    expect(t?.program).toBe("Powerlifting");
    expect(t?.programId).toBe(1643538);
    expect(t?.teamId).toBe(1607915);
    expect(t?.savedWorkoutSetId).toBe(880006);
    expect(t?.exercises[0]?.savedWorkoutSetExerciseId).toBe(770060);
    expect(t?.exercises[0]?.prescribed).toEqual(["5 @ 225"]);
  });
});

describe("selectWorkoutsByProgram", () => {
  const a = workout({
    programId: 100,
    programTitle: "Powerlifting",
    teamId: 10,
    savedWorkoutSetId: 1,
    savedWorkoutSetExerciseId: 11,
  });
  const b = workout({
    programId: 200,
    programTitle: "Hypertrophy",
    teamId: 20,
    savedWorkoutSetId: 2,
    savedWorkoutSetExerciseId: 22,
  });

  it("returns the full list when no filter is given", () => {
    expect(selectWorkoutsByProgram([a, b], {})).toHaveLength(2);
  });

  it("filters by programId", () => {
    const got = selectWorkoutsByProgram([a, b], { programId: 200 });
    expect(got).toHaveLength(1);
    expect(presentLogTargets(got)[0]?.program).toBe("Hypertrophy");
  });

  it("filters by teamId", () => {
    const got = selectWorkoutsByProgram([a, b], { teamId: 10 });
    expect(got).toHaveLength(1);
    expect(presentLogTargets(got)[0]?.program).toBe("Powerlifting");
  });

  it("filters by programTitle (case-insensitive substring, no id lookup)", () => {
    const got = selectWorkoutsByProgram([a, b], { programTitle: "hyper" });
    expect(got).toHaveLength(1);
    expect(presentLogTargets(got)[0]?.program).toBe("Hypertrophy");
  });
});
