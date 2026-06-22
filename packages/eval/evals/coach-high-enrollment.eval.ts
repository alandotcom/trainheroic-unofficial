import { describe, expect, it } from "vitest";
import { highEnrollmentAthlete, HIGH_ENROLLMENT } from "../src/datasets";
import { countCalls, hadSuccessfulRead, mentionsAny, noWrites } from "../src/grade";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";
import { COACH_WRITE_TOOLS } from "../src/tools";
import type { Scenario } from "../src/types";

// Regression guard for issue #18: an athlete enrolled in many programs on one day. The
// savedWorkoutSetId / savedWorkoutSetExerciseId a coach needs (to prescribe or log) must be
// reachable for ANY of the programs, not just the first — which the raw view truncated away. With
// the fix (compact default view + programId filter) the agent can reach the uniquely-titled
// "Powerlifting" session's ids. Runs on both surfaces.

const gate = evalGate();

const scenario: Scenario = {
  name: "coach-high-enrollment",
  dataset: highEnrollmentAthlete(),
  query:
    `${HIGH_ENROLLMENT.athleteName} is enrolled in ${HIGH_ENROLLMENT.programCount} programs. ` +
    `For their ${HIGH_ENROLLMENT.targetProgramTitle} session today, what is the saved workout set id ` +
    `and the saved workout set exercise id for the first exercise? I need those ids to adjust the set.`,
  today: HIGH_ENROLLMENT.date,
  threshold: 0.6,
  grade: (t) => {
    const calledSavedWorkouts = countCalls(t, "athlete_saved_workouts") >= 1;
    const reachedTargetIds = mentionsAny(t, [
      String(HIGH_ENROLLMENT.targetSavedWorkoutSetExerciseId),
      String(HIGH_ENROLLMENT.targetSavedWorkoutSetId),
    ]);
    const didNotWrite = noWrites(t, COACH_WRITE_TOOLS);
    const pass = calledSavedWorkouts && reachedTargetIds && didNotWrite && hadSuccessfulRead(t);
    return {
      pass,
      reason: pass
        ? "reached the target program's saved log ids"
        : `savedWorkouts=${calledSavedWorkouts} reachedTargetIds=${reachedTargetIds} didNotWrite=${didNotWrite}`,
    };
  },
};

describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: reaches a high-enrollment athlete's target program ids (#18)`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
