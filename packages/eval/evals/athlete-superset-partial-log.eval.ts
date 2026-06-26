import { describe, expect, it } from "vitest";
import { demoAthlete } from "../src/demo";
import { callsTo, didWrite, writesTo } from "../src/grade";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";
import type { Scenario } from "../src/types";

// Issues #25 / #23 / #26: logging ONE exercise of a superset must record only that exercise and
// leave the block open — the SDK fires the per-exercise data PUT but skips the block-complete PUT
// (which would flip the still-empty sibling to "done", the app's "NAN LB" bug). This drives a model
// to log just the bench press of an unlogged 2-exercise superset and asserts, end-to-end through the
// real SDK + the fake backend, that exactly the bench's data write fired and no completion fired.

const SET_ID = 1599000;
const BENCH_SWE = 1599001;
const OHP_SWE = 1599002;

/** One unlogged saved-copy exercise: prescription pre-filled across 3 slots, every made flag 0. */
function savedExercise(
  id: number,
  wseId: number,
  exerciseId: number,
  title: string,
  reps: number,
  weight: number,
) {
  const ex: Record<string, unknown> = {
    id,
    workout_set_exercise_id: wseId,
    exercise_id: exerciseId,
    exercise_title: title,
    param_1_type: "reps",
    param_2_type: "lb",
  };
  for (let i = 1; i <= 3; i += 1) {
    ex[`param_1_data_${i}`] = String(reps);
    ex[`param_2_data_${i}`] = String(weight);
    ex[`param_${i}_made`] = 0;
  }
  return ex;
}

const { dataset: base, today } = demoAthlete();

/** Today's session: one saved workout set holding a Bench Press + Overhead Press superset, unlogged. */
const supersetWorkout = {
  id: 8810,
  date: today,
  workout_title: "Upper — A1/A2 Superset",
  program_title: "Strength Block 3",
  team_title: "Strength Block 3",
  summarizedSavedWorkout: {
    workout: {
      instruction: "",
      workoutSets: [
        {
          order: 0,
          title: "A. Superset (A1/A2)",
          workoutSetExercises: [
            {
              id: 770001,
              exercise_id: 920002,
              title: "Bench Press",
              param_1_type: "reps",
              param_2_type: "lb",
              param_1_data_1: "8",
              param_2_data_1: "135",
            },
            {
              id: 770002,
              exercise_id: 920004,
              title: "Overhead Press",
              param_1_type: "reps",
              param_2_type: "lb",
              param_1_data_1: "10",
              param_2_data_1: "95",
            },
          ],
        },
      ],
    },
    saved_workout: {
      id: 708810,
      workoutSets: [
        {
          id: SET_ID,
          saved_workout_id: 708810,
          workout_set_id: 4444,
          unit: "lb",
          is_super_set: 1,
          order: 0,
          title: "A. Superset (A1/A2)",
          workoutSetExercises: [
            savedExercise(BENCH_SWE, 770001, 920002, "Bench Press", 8, 135),
            savedExercise(OHP_SWE, 770002, 920004, "Overhead Press", 10, 95),
          ],
        },
      ],
    },
  },
};

const dataset = {
  ...base,
  name: "athlete-superset-partial-log",
  athlete: {
    ...base.athlete,
    range: (start: string, end: string) =>
      (!start || today >= start) && (!end || today <= end) ? [supersetWorkout] : [],
  },
};

const scenario: Scenario = {
  name: "athlete-superset-partial-log",
  dataset,
  role: "athlete",
  mode: "write",
  today,
  query:
    `In today's "A. Superset (A1/A2)" workout I only finished the Bench Press: 3 sets of 5 reps at ` +
    `135 lb. Log just the Bench Press for today. Do NOT log the Overhead Press — I skipped it.`,
  threshold: 0.6,
  grade: (t) => {
    const calledLog = callsTo(t, "athlete_log_set").length > 0;
    const dataWrites = writesTo(t, "/savedworkoutsetexercise/");
    const dataFired = dataWrites.length > 0;
    // Only the bench's row was written (no Overhead Press data write).
    const onlyBench =
      dataFired && dataWrites.every((w) => Number((w.body as { id?: unknown })?.id) === BENCH_SWE);
    // The block-complete PUT must NOT fire — that is the step that would mark the sibling done.
    const completeFired = didWrite(t, "/savedworkoutset/");
    const pass = calledLog && dataFired && onlyBench && !completeFired;
    return {
      pass,
      reason: pass
        ? "logged only the bench press; no block-completion write fired (sibling left untouched)"
        : `calledLog=${calledLog} dataFired=${dataFired} onlyBench=${onlyBench} completeFired=${completeFired} (writes: ${t.writes.map((w) => w.path).join(", ") || "none"})`,
    };
  },
};

const gate = evalGate();

describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: logs one superset exercise without completing the block`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
