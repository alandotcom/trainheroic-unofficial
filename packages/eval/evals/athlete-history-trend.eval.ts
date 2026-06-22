import { describe, expect, it } from "vitest";
import { historyAthleteSelf } from "../src/datasets";
import { answerReached, countCalls, hadSuccessfulRead, mentionsAny, noWrites } from "../src/grade";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";
import { ATHLETE_WRITE_TOOLS } from "../src/tools";
import type { Scenario } from "../src/types";

// The athlete twin of coach-history-trend: the logged-in ATHLETE navigates their own 2-year history
// (find the lift in their exercise list, then pull its dated series) to describe a trend. Same real
// corpus, driven from the athlete surface — the role parity the bash evals had.

const gate = evalGate();
const { dataset, info } = historyAthleteSelf();

const scenario: Scenario = {
  name: "athlete-history-trend",
  dataset,
  role: "athlete",
  query:
    `I've been training for about two years. How has my "${info.corpus.topExercise.name}" been ` +
    `trending, and roughly how often have I been doing it?`,
  today: "2026-03-27",
  threshold: 0.6,
  grade: (t) => {
    const foundTheLift =
      countCalls(t, "athlete_exercises") >= 1 || countCalls(t, "athlete_exercise_history") >= 1;
    const pulledSeries = countCalls(t, "athlete_exercise_history") >= 1;
    const reached = hadSuccessfulRead(t) && answerReached(t) !== "no";
    const namedTheLift = mentionsAny(t, [info.corpus.topExercise.name]);
    const didNotWrite = noWrites(t, ATHLETE_WRITE_TOOLS);
    const pass = foundTheLift && pulledSeries && reached && namedTheLift && didNotWrite;
    return {
      pass,
      reason: pass
        ? "navigated own history and grounded a trend answer"
        : `foundTheLift=${foundTheLift} pulledSeries=${pulledSeries} reached=${reached} namedTheLift=${namedTheLift} didNotWrite=${didNotWrite}`,
    };
  },
};

describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: athlete navigates two years of their own history`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
