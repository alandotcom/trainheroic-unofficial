import { describe, expect, it } from "vitest";
import { historyInRange, type PresentedHistory } from "../src/history";

const sample: PresentedHistory = {
  liftPRs: [
    { description: "1 Rep Max", reps: 1, weight: 350, date: "2025-11-22" },
    { description: "5 Rep Max", reps: 5, weight: 295, date: "2025-09-08" },
  ],
  sessions: [
    { date: "2026-05-11", abr: "4 x 6 @ 275 lb", estimated1RM: 323, sets: [] },
    { date: "2026-04-06", abr: "4 x 5 @ 225 lb", estimated1RM: 258, sets: [] },
    { date: "2026-01-26", abr: "3 x 7 @ 245 lb", estimated1RM: 295, sets: [] },
    { date: "2025-11-10T18:00:00Z", abr: "singles", estimated1RM: 345, sets: [] },
  ],
};

describe("historyInRange", () => {
  it("returns the input untouched when no bounds are given", () => {
    expect(historyInRange(sample, undefined, undefined)).toBe(sample);
  });

  it("keeps only sessions within an inclusive window and never touches liftPRs", () => {
    const out = historyInRange(sample, "2026-02-01", "2026-06-21");
    expect(out.sessions.map((s) => s.date)).toEqual(["2026-05-11", "2026-04-06"]);
    expect(out.liftPRs).toBe(sample.liftPRs);
  });

  it("treats both bounds as inclusive", () => {
    const out = historyInRange(sample, "2026-04-06", "2026-05-11");
    expect(out.sessions.map((s) => s.date)).toEqual(["2026-05-11", "2026-04-06"]);
  });

  it("compares on the date prefix so datetime values filter correctly", () => {
    const out = historyInRange(sample, "2025-11-10", "2025-11-10");
    expect(out.sessions.map((s) => s.date)).toEqual(["2025-11-10T18:00:00Z"]);
  });

  it("applies a lower bound alone", () => {
    const out = historyInRange(sample, "2026-03-01", undefined);
    expect(out.sessions.map((s) => s.date)).toEqual(["2026-05-11", "2026-04-06"]);
  });
});
