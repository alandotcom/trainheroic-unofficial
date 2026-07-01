import { describe, expect, it } from "vitest";
import { demoAthlete } from "../src/demo";
import { writesTo } from "../src/grade";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";
import type { Scenario } from "../src/types";

// Issue #44: an athlete has no path to substitute a prescribed exercise in a COACH-SCHEDULED
// (non-personal) workout — session add/remove only touch personal sessions, and logging writes
// results into a slot without changing which exercise it is. This drives a model end to end: given
// today's coach-scheduled posterior-chain session that prescribes a Good Morning the athlete wants
// to replace with a Deadlift, it must find and use the swap. The grader asserts, from the recorded
// PUT, that the swap hit the prescribed slot and carried the replacement exercise in the query.

const SET_ID = 1599200;
// The savedWorkoutSetExerciseId — the slot to swap.
const SWE_ID = 1599201;
// The prescribed movement being swapped out (not in the athlete's history). The replacement
// (Deadlift, id 920003) is a lift already in the athlete's history, so athlete_exercises resolves
// it; the grader accepts any non-Good-Morning replacement id.
const GOOD_MORNING_ID = 930010;

/** The prescribed (template) side of the slot. */
const prescriptionExercise = {
  id: 770201,
  exercise_id: GOOD_MORNING_ID,
  title: "Good Morning",
  param_1_type: "reps",
  param_2_type: "lb",
  param_1_data_1: "8",
  param_2_data_1: "135",
};

/** The athlete's saved copy of the slot, carrying the swappable `id`. */
const savedExercise = {
  id: SWE_ID,
  workout_set_exercise_id: 770201,
  exercise_id: GOOD_MORNING_ID,
  exercise_title: "Good Morning",
  param_1_type: "reps",
  param_2_type: "lb",
  param_1_data_1: "8",
  param_2_data_1: "135",
  param_1_made: 0,
};

const { dataset: base, today } = demoAthlete();

/** Today's coach-scheduled session: one prescribed Good Morning, unlogged. */
const swapWorkout = {
  id: 8820,
  date: today,
  workout_title: "Lower B — Posterior Chain",
  program_title: "Strength Block 3",
  team_title: "Strength Block 3",
  summarizedSavedWorkout: {
    workout: {
      instruction: "Hinge work.",
      workoutSets: [
        { order: 0, title: "A. Good Morning", workoutSetExercises: [prescriptionExercise] },
      ],
    },
    saved_workout: {
      id: 708820,
      workoutSets: [
        {
          id: SET_ID,
          saved_workout_id: 708820,
          workout_set_id: 4460,
          unit: "lb",
          order: 0,
          title: "A. Good Morning",
          workoutSetExercises: [savedExercise],
        },
      ],
    },
  },
};

const dataset = {
  ...base,
  name: "athlete-swap-scheduled-exercise",
  athlete: {
    ...base.athlete,
    range: (start: string, end: string) =>
      (!start || today >= start) && (!end || today <= end) ? [swapWorkout] : [],
  },
};

const scenario: Scenario = {
  name: "athlete-swap-scheduled-exercise",
  dataset,
  role: "athlete",
  mode: "write",
  today,
  query:
    `My coach scheduled a Good Morning in today's Posterior Chain session, but my lower back is ` +
    `cranky and I'd rather do Deadlifts for that slot instead. Swap the prescribed Good Morning ` +
    `for Deadlift in that scheduled workout — don't just log it as something else.`,
  threshold: 0.6,
  grade: (t) => {
    const swap = writesTo(t, "/savedWorkoutSetExercises/").find(
      (w) => w.method === "PUT" && w.path.includes(`/${SWE_ID}`),
    );
    const hitSlot = swap !== undefined;
    // The replacement rides in the query string (empty body), so assert on the recorded path. The
    // athlete may resolve "Deadlift" to any of several ids depending on the route they use, so the
    // signal for issue #44 is simply that the prescribed slot was swapped to a DIFFERENT exercise —
    // not the original Good Morning, and not a no-op.
    const swapped =
      (swap?.path.includes("exerciseId=") ?? false) &&
      !(swap?.path.includes(`exerciseId=${GOOD_MORNING_ID}`) ?? false);
    const pass = hitSlot && swapped;
    return {
      pass,
      reason: pass
        ? `swapped slot ${SWE_ID} to a different exercise in the scheduled workout (${swap?.path})`
        : `hitSlot=${hitSlot} swapped=${swapped} (writes: ${t.writes.map((w) => `${w.method} ${w.path}`).join(" ; ") || "none"})`,
    };
  },
};

const gate = evalGate();

describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: swaps a prescribed exercise in a coach-scheduled workout`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
