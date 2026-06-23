import { describe, expect, it } from "vitest";
import { coachDayLogged } from "../src/demo";
import { callsTo, finalMentions, hadSuccessfulRead } from "../src/grade";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";
import type { Scenario } from "../src/types";

// Finding #5: a coach asking "what did <athlete> do today" must use athlete_saved_workouts with a
// one-day window — the date-precise path that carries the date + performed sets — NOT athlete_training,
// which is a whole-month overview with no per-session dates. A weaker model historically reached for
// athlete_training (the "training" name reads right) and thrashed. This guards that the agent finds
// the date-precise tool; it's the regression guard for the tool-description fix that steers it there.

const gate = evalGate();
const { dataset, athleteName, today } = coachDayLogged();

const scenario: Scenario = {
  name: "coach-per-date-log",
  dataset,
  query: `What exactly did ${athleteName} do in their workout today? List the lifts and weights.`,
  today,
  threshold: 0.6,
  grade: (t) => {
    // The date-precise read fired with a narrow window (today→today, or at least an end-dated window).
    const saved = callsTo(t, "athlete_saved_workouts");
    const usedDatePrecise = saved.some(
      (c) => c.input.endDate === today || c.input.startDate === today,
    );
    // Grounded the answer in the actual logged lift (Back Squat at the today weight, 305).
    const namedTheWork = finalMentions(t, ["305"]);
    const pass = usedDatePrecise && namedTheWork && hadSuccessfulRead(t);
    return {
      pass,
      reason: pass
        ? "used athlete_saved_workouts for the specific day and named the logged work"
        : `usedDatePrecise=${usedDatePrecise} (saved_workouts=${saved.length}) namedTheWork=${namedTheWork}`,
    };
  },
};

describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: answers "what did they do today" via the date-precise tool`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
