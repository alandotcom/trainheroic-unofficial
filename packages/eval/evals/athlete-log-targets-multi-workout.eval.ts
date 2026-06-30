import { describe, expect, it } from "vitest";
import { demoAthlete } from "../src/demo";
import { callsTo, hadSuccessfulRead, writesTo } from "../src/grade";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";
import { programWorkout } from "../src/shapes";
import type { Scenario } from "../src/types";

// GH #28/#29: an athlete on two programs has TWO scheduled workouts on the same date. To log into one
// of them, the agent needs that workout's savedWorkoutSetId + savedWorkoutSetExerciseId — which the
// flattened athlete_workouts view drops. The fix is athlete_log_targets: a compact, program-filtered
// view of exactly those ids (no oversized raw blob). This drives a model end to end and asserts it
// read the ids from athlete_log_targets and logged ONLY the targeted program's exercise.

const { dataset: base, today } = demoAthlete();

const SB_SET = 880100;
const SB_SWE = 770100;
const CB_SET = 880101;
const CB_SWE = 770101;

// Two coach-scheduled workouts on the same day, different programs — each loggable (saved copy with
// its workout_set_exercise_id present) but unlogged.
const strength = programWorkout({
  id: 149100,
  date: today,
  workoutTitle: "Strength Block — Day 1",
  programId: 50100,
  programTitle: "Strength Block",
  teamId: 10100,
  savedWorkoutId: 148100,
  savedWorkoutSetId: SB_SET,
  exercises: [
    { id: SB_SWE, exerciseId: 920002, title: "Bench Press", sets: [{ reps: "5", weight: "225" }] },
  ],
});
const conditioning = programWorkout({
  id: 149101,
  date: today,
  workoutTitle: "Conditioning Block — Day 1",
  programId: 50101,
  programTitle: "Conditioning Block",
  teamId: 10101,
  savedWorkoutId: 148101,
  savedWorkoutSetId: CB_SET,
  exercises: [
    { id: CB_SWE, exerciseId: 920001, title: "Back Squat", sets: [{ reps: "10", weight: "185" }] },
  ],
});

const dataset = {
  ...base,
  name: "athlete-log-targets-multi-workout",
  athlete: {
    ...base.athlete,
    range: (start: string, end: string) =>
      (!start || today >= start) && (!end || today <= end) ? [strength, conditioning] : [],
  },
};

const scenario: Scenario = {
  name: "athlete-log-targets-multi-workout",
  dataset,
  role: "athlete",
  mode: "write",
  today,
  query:
    `I have two workouts scheduled today: a "Strength Block" session and a "Conditioning Block" ` +
    `session. I only did the Strength Block — log its Bench Press as 5 reps at 225 lb. Leave the ` +
    `Conditioning Block alone; I didn't do it.`,
  threshold: 0.6,
  grade: (t) => {
    // The agent reached the log ids through athlete_log_targets (the compact, no-raw path).
    const usedTargets = callsTo(t, "athlete_log_targets").length > 0;
    // It wrote the Strength Block exercise...
    const wroteStrength = writesTo(t, "/savedworkoutsetexercise/").some(
      (w) => Number((w.body as { id?: unknown })?.id) === SB_SWE,
    );
    // ...and did NOT touch the Conditioning Block exercise.
    const leftConditioning = writesTo(t, "/savedworkoutsetexercise/").every(
      (w) => Number((w.body as { id?: unknown })?.id) !== CB_SWE,
    );
    const pass = usedTargets && wroteStrength && leftConditioning && hadSuccessfulRead(t);
    return {
      pass,
      reason: pass
        ? "read the ids from athlete_log_targets and logged only the Strength Block bench"
        : `usedTargets=${usedTargets} wroteStrength=${wroteStrength} leftConditioning=${leftConditioning}`,
    };
  },
};

const gate = evalGate();

describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: logs into the targeted scheduled workout among several that day`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
