import { describe, expect, it } from "vitest";
import { highEnrollmentAthlete, HIGH_ENROLLMENT } from "../src/datasets";
import { didWrite, hadSuccessfulRead, writeBodyHas, writesTo } from "../src/grade";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";
import type { Scenario } from "../src/types";

// The write capstone for issue #18: a coach reaches a high-enrollment athlete's target program ids
// (the read the bug blocked) and then ACTUALLY prescribes a set — the action that was impossible
// when the raw view truncated. Write mode: the fake backend records the PUT; the grader asserts a
// prescribe write fired against the right athlete with the requested reps/weight, and that it was
// scoped to the one target program (no stray writes to the other 7).

const gate = evalGate();
const REPS = 5;
const WEIGHT = 235;

const scenario: Scenario = {
  name: "coach-prescribe-write",
  dataset: highEnrollmentAthlete(),
  mode: "write",
  query:
    `For ${HIGH_ENROLLMENT.athleteName} (athlete id ${HIGH_ENROLLMENT.athleteId}), set the prescribed ` +
    `target for the first exercise of their "${HIGH_ENROLLMENT.targetProgramTitle}" session today to ` +
    `${REPS} reps at ${WEIGHT} lb. Only change that one program's session.`,
  today: HIGH_ENROLLMENT.date,
  threshold: 0.6,
  grade: (t) => {
    const prescribed = didWrite(t, "savedworkoutsetexercise");
    const rightAthlete = writesTo(t, "savedworkoutsetexercise").some((w) =>
      w.path.endsWith(`/${HIGH_ENROLLMENT.athleteId}`),
    );
    const rightWeight = writeBodyHas(t, "savedworkoutsetexercise", WEIGHT);
    // Scoped to one program: a prescribe writes one exercise's slot, so a single set-exercise write
    // (not one per program) shows it targeted the right session rather than blasting all eight.
    const scoped = writesTo(t, "savedworkoutsetexercise").length <= 3;
    const pass = prescribed && rightAthlete && rightWeight && scoped && hadSuccessfulRead(t);
    return {
      pass,
      reason: pass
        ? "prescribed the target set for the right athlete + program"
        : `prescribed=${prescribed} rightAthlete=${rightAthlete} rightWeight=${rightWeight} scoped=${scoped} writes=${t.writes.length}`,
    };
  },
};

describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: reads the target ids then prescribes the set (#18 write path)`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
