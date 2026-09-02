import { describe, expect, it } from "vitest";
import { historyInRange } from "../src/exercise-history";
import type { PresentedExerciseHistory } from "../src/index";

const sample: PresentedExerciseHistory = {
  liftPRs: [{ description: "1 Rep Max", reps: 1, weight: 350, units: "lb", date: "2025-11-22" }],
  sessions: [
    { date: "2026-05-11", abr: "4 x 6 @ 275 lb", notes: null, estimated1RM: 323, sets: [] },
    { date: "2026-04-06", abr: "4 x 5 @ 225 lb", notes: null, estimated1RM: 258, sets: [] },
    { date: "2025-11-10T18:00:00Z", abr: "singles", notes: null, estimated1RM: 345, sets: [] },
  ],
};

describe("historyInRange", () => {
  it("returns the input untouched when no bounds are given", () => {
    expect(historyInRange(sample, undefined, undefined)).toBe(sample);
  });

  it("keeps sessions inside an inclusive window and never touches liftPRs", () => {
    const out = historyInRange(sample, "2026-04-06", "2026-05-11");
    expect(out.sessions.map((s) => s.date)).toEqual(["2026-05-11", "2026-04-06"]);
    expect(out.liftPRs).toBe(sample.liftPRs);
  });

  it("keeps a timestamped session that falls on the inclusive upper bound", () => {
    // A plain string compare would rank "2025-11-10T18:00:00Z" after "2025-11-10" and drop it.
    const out = historyInRange(sample, undefined, "2025-11-10");
    expect(out.sessions.map((s) => s.date)).toEqual(["2025-11-10T18:00:00Z"]);
  });

  it("applies a lower bound alone", () => {
    const out = historyInRange(sample, "2026-03-01", undefined);
    expect(out.sessions.map((s) => s.date)).toEqual(["2026-05-11", "2026-04-06"]);
  });
});
