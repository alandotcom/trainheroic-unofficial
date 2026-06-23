import { describe, expect, it } from "vitest";
import { ambiguousBodybuilding } from "../src/datasets";
import { answerReached, finalIsQuestion, mentionsAny, noWrites } from "../src/grade";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";
import { COACH_WRITE_TOOLS } from "../src/tools";
import type { Scenario } from "../src/types";

// Problem under test: "athlete logs for today's bodybuilding" is ambiguous when several programs
// are titled with "Bodybuilding". The right move is to ask which one. Failure mode guarded: it
// silently guesses one program (and pulls/changes data) instead of clarifying. Runs on both
// surfaces — capability names are normalized, so noWrites() works for CLI commands too.

const gate = evalGate();

const scenario: Scenario = {
  name: "coach-ambiguous-clarify",
  dataset: ambiguousBodybuilding(),
  query: "Give me athlete logs for today's bodybuilding.",
  today: "2026-06-22",
  threshold: 0.5,
  grade: (t) => {
    const asked = finalIsQuestion(t) && mentionsAny(t, ["bodybuilding", "which", "program"]);
    const didNotWrite = noWrites(t, COACH_WRITE_TOOLS);
    const stoppedToAsk = answerReached(t) !== "yes";
    const pass = asked && didNotWrite && stoppedToAsk;
    return {
      pass,
      reason: pass
        ? "asked a clarifying question without guessing"
        : `asked=${asked} didNotWrite=${didNotWrite} stoppedToAsk=${stoppedToAsk}`,
    };
  },
};

describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: asks which bodybuilding program instead of guessing`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
