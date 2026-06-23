import { describe, expect, it } from "vitest";
import { ATHLETE_COMMANDS, COACH_COMMANDS, normalizeCliCommand } from "../src/canonical";
import { ROLE_TOOLS } from "../src/tools";

// Drift guard for the hand-maintained CLI-command → capability maps. The maps in canonical.ts and
// the tool partitions in tools.ts must agree (and both must track the real CLI/MCP names), or a
// grader silently under-counts a renamed command and a passing agent reads as failing. This catches
// the cheap-but-common drift — a canonical command pointing at a capability that isn't in the role's
// tool lists (a typo or a tool rename) — without needing claude or a live server. It does NOT prove
// the lists match the SERVER's registered tools; that gap is covered by the LLM evals turning red.

describe("canonical command maps stay in sync with the tool partition", () => {
  for (const role of ["coach", "athlete"] as const) {
    const commands = role === "coach" ? COACH_COMMANDS : ATHLETE_COMMANDS;
    const known = new Set([...ROLE_TOOLS[role].readTools, ...ROLE_TOOLS[role].writeTools]);

    it(`${role}: every CLI command maps to a tool in the ${role} read/write lists`, () => {
      const orphans = Object.entries(commands)
        .filter(([, capability]) => !known.has(capability))
        .map(([cmd, capability]) => `${cmd} → ${capability}`);
      expect(orphans, `canonical ${role} commands pointing at unknown capabilities`).toEqual([]);
    });
  }

  it("normalizes a coach command to the matching capability with its flags", () => {
    const got = normalizeCliCommand(
      "trainheroic coach athlete-workouts --athlete 100001 --program bodybuilding",
      "coach",
    );
    expect(got).toEqual({
      name: "athlete_saved_workouts",
      input: { athleteId: "100001", program: "bodybuilding" },
    });
  });

  it("ignores a non-trainheroic command", () => {
    expect(normalizeCliCommand("ls -la", "coach")).toBeNull();
  });
});
