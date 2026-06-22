import { describe, expect, it } from "vitest";
import { ATHLETE_READ_BANK, ATHLETE_WRITE_BANK, bankScenarios } from "../src/bank";
import { demoAthlete } from "../src/demo";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";

// The athlete half of the historic query bank, ported as data-backed scenarios against a populated
// demo athlete (logged + scheduled workouts, working maxes, PRs, a progression). Breadth coverage:
// each query must be answered via the capability that should answer it. Run all with `pnpm eval`,
// or one section by file filter. Read + write (write fires against the disposable fake backend).

const gate = evalGate();
const { dataset, today } = demoAthlete();

const readScenarios = bankScenarios({
  entries: ATHLETE_READ_BANK,
  dataset,
  role: "athlete",
  mode: "read",
  today,
});
const writeScenarios = bankScenarios({
  entries: ATHLETE_WRITE_BANK,
  dataset,
  role: "athlete",
  mode: "write",
  today,
});

describe.skipIf(!gate.enabled)("athlete query bank", () => {
  for (const scenario of [...readScenarios, ...writeScenarios]) {
    for (const surface of scenarioSurfaces(scenario)) {
      it(`${surface} — ${scenario.name}: ${scenario.query}`, async () => {
        const r = await runScenario(scenario, surface);
        expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
      });
    }
  }
});
