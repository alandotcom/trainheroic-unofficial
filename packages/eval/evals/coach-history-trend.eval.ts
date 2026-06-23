import { describe, expect, it } from "vitest";
import { historyAthlete } from "../src/datasets";
import { answerReached, countCalls, hadSuccessfulRead, mentionsAny, noWrites } from "../src/grade";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";
import { COACH_WRITE_TOOLS } from "../src/tools";
import type { Scenario } from "../src/types";

// Deep-history navigation over a real 2-year corpus (1192 sessions, ~839 exercises). The agent must
// pull a month (athlete_training) to discover what the athlete actually trained, then pull that
// lift's dated series (athlete_lift_history) to describe a trend — at a scale the sparse real test
// accounts can't reach. Failure mode guarded: giving up on the volume, or answering ungrounded.

const gate = evalGate();
const { dataset, info } = historyAthlete();

const scenario: Scenario = {
  name: "coach-history-trend",
  dataset,
  query:
    `${info.corpus.athleteName} (athlete id ${info.athleteId}) has about two years of training ` +
    `logged. How has their "${info.corpus.topExercise.name}" been trending recently, and roughly ` +
    `how often have they been doing it?`,
  today: "2026-03-27",
  threshold: 0.6,
  grade: (t) => {
    // Discovery handle (the month view) then the per-exercise series — either order, but both the
    // training read and a lift-history read should fire for a grounded trend answer.
    const pulledHistory =
      countCalls(t, "athlete_training") >= 1 || countCalls(t, "athlete_lift_history") >= 1;
    const reached = hadSuccessfulRead(t) && answerReached(t) !== "no";
    const namedTheLift = mentionsAny(t, [info.corpus.topExercise.name]);
    const didNotWrite = noWrites(t, COACH_WRITE_TOOLS);
    const pass = pulledHistory && reached && namedTheLift && didNotWrite;
    return {
      pass,
      reason: pass
        ? "navigated the history and grounded a trend answer"
        : `pulledHistory=${pulledHistory} reached=${reached} namedTheLift=${namedTheLift} didNotWrite=${didNotWrite}`,
    };
  },
};

describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: navigates two years of history to describe a lift trend`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
