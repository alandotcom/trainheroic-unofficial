import { describe, expect, it } from "vitest";
import { manyPrograms } from "../src/datasets";
import { answerReached, countCalls, hadSuccessfulRead, mentionsAny } from "../src/grade";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";
import type { Scenario } from "../src/types";

// Problem under test: with dozens of team programs (and an empty standalone-programs list), the
// agent must follow list_programs([]) → list_teams → one get_program per team to learn what each
// program is. Failure mode guarded: it calls list_programs once, sees [], and wrongly tells the
// coach they have no programs — or gives up partway. Runs on both surfaces.

const gate = evalGate();

const scenario: Scenario = {
  name: "coach-many-programs",
  dataset: manyPrograms(30),
  query: "List all my training programs and what each one is for.",
  today: "2026-06-22",
  threshold: 0.6,
  grade: (t) => {
    const exploredTeams = countCalls(t, "list_teams") >= 1;
    const readPrograms = countCalls(t, "get_program") >= 3;
    const reached = hadSuccessfulRead(t) && answerReached(t) !== "no";
    const deniedHavingPrograms = mentionsAny(t, [
      "no programs",
      "don't have any programs",
      "do not have any programs",
      "you have no",
    ]);
    const pass = exploredTeams && readPrograms && reached && !deniedHavingPrograms;
    return {
      pass,
      reason: pass
        ? "explored teams and read several programs"
        : `list_teams=${countCalls(t, "list_teams")} get_program=${countCalls(t, "get_program")} reached=${reached} deniedHavingPrograms=${deniedHavingPrograms}`,
    };
  },
};

describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: walks teams into program detail rather than concluding 'no programs'`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
