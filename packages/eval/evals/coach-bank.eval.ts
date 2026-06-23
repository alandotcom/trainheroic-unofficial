import { describe, expect, it } from "vitest";
import { bankScenarios, COACH_READ_BANK, COACH_WRITE_BANK } from "../src/bank";
import { demoCoach } from "../src/demo";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";

// The coach half of the historic query bank, ported as data-backed scenarios against a populated
// demo coach (named roster, teams/programs, a resolvable custom exercise, a recent inbound message,
// an athlete with a session prescribed today to log against). Breadth coverage across read + write.

const gate = evalGate();
const { dataset, today } = demoCoach();

const readScenarios = bankScenarios({
  entries: COACH_READ_BANK,
  dataset,
  role: "coach",
  mode: "read",
  today,
});
const writeScenarios = bankScenarios({
  entries: COACH_WRITE_BANK,
  dataset,
  role: "coach",
  mode: "write",
  today,
});

describe.skipIf(!gate.enabled)("coach query bank", () => {
  for (const scenario of [...readScenarios, ...writeScenarios]) {
    for (const surface of scenarioSurfaces(scenario)) {
      it(`${surface} — ${scenario.name}: ${scenario.query}`, async () => {
        const r = await runScenario(scenario, surface);
        expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
      });
    }
  }
});
