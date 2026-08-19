import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  athleteProfileOutputSchema,
  athleteWorkoutsOutputSchema,
  messageDraftOutputSchema,
  toolOutputSchema,
  truncatedOutputSchema,
} from "../src/tool-output";

describe("tool output schemas", () => {
  it("converts typed tool outputs to JSON Schema", () => {
    const schema = z.toJSONSchema(toolOutputSchema(athleteProfileOutputSchema));
    expect(schema).toMatchObject({ $schema: expect.stringContaining("2020-12") });
    expect(JSON.stringify(schema)).toContain("summary");
  });

  it("accepts each athlete_workouts result mode", () => {
    expect(athleteWorkoutsOutputSchema.safeParse([]).success).toBe(true);
    expect(
      athleteWorkoutsOutputSchema.safeParse([
        {
          id: 1,
          date: "2026-08-18",
          title: "Heavy day",
          program: "Strength",
          team: null,
          logged: true,
          personal: false,
          exerciseCount: 3,
          performedCount: 2,
        },
      ]).success,
    ).toBe(true);
  });

  it("accepts controlled message drafts and structured truncation", () => {
    expect(
      messageDraftOutputSchema.safeParse({
        draft: true,
        note: "NOT sent.",
        would_POST: "/v5/messaging/streams/1/comments",
        payload: { text: "hello" },
      }).success,
    ).toBe(true);
    expect(
      truncatedOutputSchema.safeParse({
        preview: "partial",
        __truncated: { total: 100, omitted: 93, hint: "narrow" },
      }).success,
    ).toBe(true);
  });
});
