import { describe, expect, it } from "vitest";
import { demoAthlete } from "../src/demo";
import { callsTo } from "../src/grade";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";
import { athleteRangeWorkout } from "../src/shapes";
import type { Scenario } from "../src/types";

// GH #28: logging an off-plan session leaves a stray PERSONAL session on the calendar that nothing
// could delete. The fix is athlete_session_remove (DELETE /v5/programWorkouts/{id}), gated and
// personal-only. This drives a model end to end and asserts it found the stray session's id and
// removed it (a DELETE against that programWorkout), without nuking the coach-scheduled workout.

const { dataset: base, today } = demoAthlete();

const STRAY_ID = 5550000;

/** A pre-existing personal session today (personal_cal), e.g. an accidental athlete_log_session. */
const strayPersonal = {
  id: STRAY_ID,
  date: today,
  workout_title: "Personal Session",
  personal_cal: true,
  program_title: null,
  team_title: null,
  summarizedSavedWorkout: {
    saved_workout: {
      id: 5550003,
      workoutSets: [
        {
          id: 5560000,
          saved_workout_id: 5550003,
          workout_set_id: 5590000,
          order: 0,
          unit: "lb",
          workoutSetExercises: [
            {
              id: 5570000,
              workout_set_exercise_id: 5580000,
              exercise_id: 920005,
              exercise_title: "Pull-Up",
              param_1_type: "reps",
              param_2_type: "lb",
              param_1_made: 1,
              param_1_data_1: "18",
              param_2_data_1: "",
            },
          ],
        },
      ],
    },
  },
};

// A real coach-scheduled workout also sits on the day — the agent must remove the personal one, not this.
const scheduled = athleteRangeWorkout({
  id: 8803,
  date: today,
  title: "Lower B",
  program: "Strength Block 3",
  logged: false,
  exercises: [{ exerciseId: 920001, title: "Back Squat", reps: 3, weight: 295 }],
});

const dataset = {
  ...base,
  name: "athlete-remove-personal-session",
  athlete: {
    ...base.athlete,
    range: (start: string, end: string) =>
      (!start || today >= start) && (!end || today <= end) ? [scheduled, strayPersonal] : [],
  },
};

const scenario: Scenario = {
  name: "athlete-remove-personal-session",
  dataset,
  role: "athlete",
  mode: "write",
  today,
  query:
    `I accidentally logged a separate personal "Pull-Up" session for today — it's a stray entry that ` +
    `shouldn't be there. Please delete that personal session. Don't touch my scheduled Lower B workout.`,
  threshold: 0.6,
  grade: (t) => {
    const called = callsTo(t, "athlete_session_remove").length > 0;
    // The DELETE fired against the stray personal session's programWorkout id (not the scheduled one).
    const deletedStray = t.writes.some(
      (w) => w.method === "DELETE" && w.path.endsWith(`/${STRAY_ID}`),
    );
    const pass = called && deletedStray;
    return {
      pass,
      reason: pass
        ? "removed the stray personal session via athlete_session_remove"
        : `called=${called} deletedStray=${deletedStray}`,
    };
  },
};

const gate = evalGate();

describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: deletes the stray personal session`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
