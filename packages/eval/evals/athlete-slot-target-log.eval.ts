import { describe, expect, it } from "vitest";
import { demoAthlete } from "../src/demo";
import { callsTo, writesTo } from "../src/grade";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";
import type { Scenario } from "../src/types";

// Issues #23 / #26: logging a partial set into a multi-slot prescription must land in the targeted
// positions, not fill sequentially from slot 1. Given an 8,5,3,1,1,1 "find a 1RM" ramp, logging the
// three top singles should use the per-set `slot` so they land in positions 4-6 (the prescribed
// single positions) and the un-logged warm-up slots 1-3 stay unmarked. This drives a model end to
// end and asserts, from the recorded write body, that slots 4-6 are the performed ones — which only
// holds if the model used slot targeting (a sequential log would mark slots 1-3 instead).

const SET_ID = 1599100;
const BENCH_SWE = 1599101;
const RAMP_REPS = [8, 5, 3, 1, 1, 1];

/** An unlogged saved-copy exercise carrying the ramp prescription across N slots, every made flag 0. */
function rampExercise() {
  const ex: Record<string, unknown> = {
    id: BENCH_SWE,
    workout_set_exercise_id: 770101,
    exercise_id: 920002,
    exercise_title: "Bench Press",
    param_1_type: "reps",
    param_2_type: "lb",
  };
  // No prescribed weight: the athlete works up to a 1RM.
  RAMP_REPS.forEach((reps, i) => {
    ex[`param_1_data_${i + 1}`] = String(reps);
    ex[`param_2_data_${i + 1}`] = "";
    ex[`param_${i + 1}_made`] = 0;
  });
  return ex;
}

const prescriptionExercise = {
  id: 770101,
  exercise_id: 920002,
  title: "Bench Press",
  param_1_type: "reps",
  param_2_type: "lb",
  ...Object.fromEntries(RAMP_REPS.map((reps, i) => [`param_1_data_${i + 1}`, String(reps)])),
};

const { dataset: base, today } = demoAthlete();

/** Today's session: a single Bench Press set prescribed as an 8,5,3,1,1,1 ramp, unlogged. */
const rampWorkout = {
  id: 8811,
  date: today,
  workout_title: "Bench — find a 1RM",
  program_title: "Strength Block 3",
  team_title: "Strength Block 3",
  summarizedSavedWorkout: {
    workout: {
      instruction: "Work up to a heavy single.",
      workoutSets: [
        { order: 0, title: "A. Bench Press", workoutSetExercises: [prescriptionExercise] },
      ],
    },
    saved_workout: {
      id: 708811,
      workoutSets: [
        {
          id: SET_ID,
          saved_workout_id: 708811,
          workout_set_id: 4445,
          unit: "lb",
          order: 0,
          title: "A. Bench Press",
          workoutSetExercises: [rampExercise()],
        },
      ],
    },
  },
};

const dataset = {
  ...base,
  name: "athlete-slot-target-log",
  athlete: {
    ...base.athlete,
    range: (start: string, end: string) =>
      (!start || today >= start) && (!end || today <= end) ? [rampWorkout] : [],
  },
};

const scenario: Scenario = {
  name: "athlete-slot-target-log",
  dataset,
  role: "athlete",
  mode: "write",
  today,
  query:
    `On today's Bench Press I worked up to a heavy single. The program prescribed six sets — 8, 5, ` +
    `3, then three singles. I only hit the three top singles: 1 rep at 245, 1 at 265, and 1 at 275. ` +
    `Log just those three singles in their slots (the last three of the six); leave the 8/5/3 ` +
    `warm-up sets unlogged.`,
  threshold: 0.6,
  grade: (t) => {
    const calledLog = callsTo(t, "athlete_log_set").length > 0;
    const write = writesTo(t, "/savedworkoutsetexercise/").find(
      (w) => Number((w.body as { id?: unknown })?.id) === BENCH_SWE,
    );
    const body = write?.body as Record<string, unknown> | undefined;
    const made = (n: number) => (body ? Number(body[`param_${n}_made`]) : -1);
    // The three singles landed in slots 4-6 (slot targeting) and the warm-up slots 1-3 stay unmarked.
    const singlesAt456 = [4, 5, 6].every((n) => made(n) === 1);
    const warmupsUnmarked = [1, 2, 3].every((n) => made(n) === 0);
    const weightsPlaced = !!body && body.param_2_data_4 === "245" && body.param_2_data_6 === "275";
    const pass = calledLog && singlesAt456 && warmupsUnmarked && weightsPlaced;
    return {
      pass,
      reason: pass
        ? "placed the three singles in slots 4-6 via slot targeting; warm-up slots 1-3 left unmarked"
        : `calledLog=${calledLog} singlesAt456=${singlesAt456} warmupsUnmarked=${warmupsUnmarked} weightsPlaced=${weightsPlaced} made=[${[1, 2, 3, 4, 5, 6].map(made).join(",")}]`,
    };
  },
};

const gate = evalGate();

describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: places a partial log in the prescribed slots`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
