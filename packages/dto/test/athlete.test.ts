import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  athleteProfileSummarySchema,
  athletePrefsSchema,
  athleteUserSchema,
  athleteWorkingMaxListSchema,
  athleteWorkoutRangeArgsSchema,
  coachPrescribeSetArgsSchema,
  exerciseHistoryListSchema,
  exerciseStatsSchema,
  logSetArgsSchema,
  personalRecordListSchema,
} from "../src/athlete";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));

describe("athlete response schemas", () => {
  it("parses the live profile summary, prefs, user, working maxes, PRs, stats", () => {
    expect(athleteProfileSummarySchema.safeParse(fixture("profile-summary.json")).success).toBe(
      true,
    );
    expect(athletePrefsSchema.safeParse(fixture("prefs.json")).success).toBe(true);
    expect(athleteUserSchema.safeParse(fixture("user.json")).success).toBe(true);
    expect(athleteWorkingMaxListSchema.safeParse(fixture("working-max.json")).success).toBe(true);
    expect(personalRecordListSchema.safeParse(fixture("personal-records.json")).success).toBe(true);
    expect(exerciseStatsSchema.safeParse(fixture("exercise-stats.json")).success).toBe(true);
  });

  it("parses the exercise history list and tolerates string-or-number param types", () => {
    expect(exerciseHistoryListSchema.safeParse(fixture("exercise-history-list.json")).success).toBe(
      true,
    );
    const item = exerciseHistoryListSchema.safeParse([
      { id: "5", title: "Back Squat", param1Type: "3", param2Type: null, extra: 1 },
    ]);
    expect(item.success).toBe(true);
  });
});

describe("athlete input schemas", () => {
  it("requires YYYY-MM-DD dates for the workout range", () => {
    expect(
      athleteWorkoutRangeArgsSchema.safeParse({ startDate: "2026-01-01", endDate: "2026-02-01" })
        .success,
    ).toBe(true);
    expect(
      athleteWorkoutRangeArgsSchema.safeParse({ startDate: "01/01/2026", endDate: "x" }).success,
    ).toBe(false);
  });

  it("requires at least one result with at least one set for logging", () => {
    expect(
      logSetArgsSchema.safeParse({
        date: "2026-06-01",
        savedWorkoutSetId: 123,
        results: [{ savedWorkoutSetExerciseId: 9, sets: [{ param1: 5, param2: 225 }] }],
      }).success,
    ).toBe(true);
    expect(
      logSetArgsSchema.safeParse({ date: "2026-06-01", savedWorkoutSetId: 123, results: [] })
        .success,
    ).toBe(false);
  });

  it("accepts an in-range set slot and rejects an out-of-range one", () => {
    const withSlot = (slot: number) =>
      logSetArgsSchema.safeParse({
        date: "2026-06-01",
        savedWorkoutSetId: 123,
        results: [{ savedWorkoutSetExerciseId: 9, sets: [{ slot, param1: 1, param2: 245 }] }],
      });
    const ok = withSlot(4);
    expect(ok.success).toBe(true);
    // The log path keeps slot so a partial log can target a position.
    expect(ok.data?.results[0]?.sets[0]?.slot).toBe(4);
    expect(withSlot(0).success).toBe(false);
    expect(withSlot(11).success).toBe(false);
  });

  it("prescribe args drop the log-only slot field (full-replacement write has no slot)", () => {
    const parsed = coachPrescribeSetArgsSchema.safeParse({
      athleteId: 1,
      date: "2026-06-01",
      savedWorkoutSetId: 123,
      results: [{ savedWorkoutSetExerciseId: 9, sets: [{ slot: 4, param1: 5, param2: 225 }] }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.results[0]?.sets[0]).not.toHaveProperty("slot");
  });
});
