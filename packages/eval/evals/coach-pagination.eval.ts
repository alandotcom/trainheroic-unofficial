import { describe, expect, it } from "vitest";
import { largeRoster } from "../src/datasets";
import {
  answerReached,
  countCalls,
  hadSuccessfulRead,
  narrowedAfterTruncation,
  soundsLikeGivingUp,
  usedNarrowingArg,
} from "../src/grade";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";
import type { Scenario } from "../src/types";

// Problem under test: faced with a large data pull (a few-hundred-athlete roster that truncates),
// the agent should narrow or pivot to an aggregate read, not give up. This is MCP-only: truncation
// is an MCP result-budget behavior; the CLI streams the full result so there is nothing to give up
// on. Failure mode guarded: it stops after the first truncated response and apologizes.

const gate = evalGate();

const scenario: Scenario = {
  name: "coach-pagination",
  dataset: largeRoster(300),
  query: "Summarize training activity across my whole roster this month.",
  today: "2026-06-22",
  surfaces: ["mcp"],
  threshold: 0.6,
  grade: (t) => {
    const reached = hadSuccessfulRead(t) && t.answerText.length > 0 && answerReached(t) !== "no";
    const handledScale =
      narrowedAfterTruncation(t) ||
      usedNarrowingArg(t, "list_athletes") ||
      countCalls(t, "roster_activity") > 0 ||
      countCalls(t, "team_volume") > 0;
    const gaveUp = soundsLikeGivingUp(t);
    const pass = reached && handledScale && !gaveUp;
    return {
      pass,
      reason: pass
        ? "reached an answer and handled the scale"
        : `reached=${reached} handledScale=${handledScale} gaveUp=${gaveUp}`,
    };
  },
};

describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: narrows or aggregates instead of giving up`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
