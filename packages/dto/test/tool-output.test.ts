import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  athleteProfileOutputSchema,
  athleteWorkoutsOutputSchema,
  messageDraftOutputSchema,
  teamVolumeOutputSchema,
  toolOutputSchema,
  toolOutputSchemaFor,
  truncatedOutputSchema,
} from "../src/tool-output";

const teamVolumeAthlete = {
  athleteId: 1,
  name: "A",
  sessions: 1,
  reps: 1,
  volume: 1,
  firstLoggedDate: null,
  lastLoggedDate: null,
};

const completeTeamVolume = {
  window: { start: "2026-01-01", end: "2026-01-31" },
  athletes: [teamVolumeAthlete, { ...teamVolumeAthlete, athleteId: 2, name: "B" }],
  totals: { athletes: 2, sessions: 2, reps: 2, volume: 2 },
};

const truncatedTeamVolume = {
  window: completeTeamVolume.window,
  athletes: [teamVolumeAthlete],
  totals: { athletes: 50, sessions: 200, reps: 1, volume: 1 },
  __truncated: {
    field: "athletes",
    returned: 1,
    total: 50,
    omitted: 49,
    hint: "narrow",
  },
};

describe("tool output schemas", () => {
  it("converts typed tool outputs to JSON Schema", () => {
    const schema = z.toJSONSchema(toolOutputSchema(athleteProfileOutputSchema));
    expect(schema).toMatchObject({ $schema: expect.stringContaining("2020-12") });
    expect(JSON.stringify(schema)).toContain("summary");
    expect(JSON.stringify(z.toJSONSchema(toolOutputSchema(teamVolumeOutputSchema)))).toContain(
      "__truncated",
    );
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

  it("keeps __truncated when an object-array result is budget-sliced in place", () => {
    const parsed = toolOutputSchemaFor("team_volume").parse(truncatedTeamVolume);
    expect(parsed).toEqual(truncatedTeamVolume);
  });

  it("accepts a complete unmarked object result", () => {
    const parsed = toolOutputSchema(teamVolumeOutputSchema).parse(completeTeamVolume);
    expect(parsed).toEqual(completeTeamVolume);
  });

  it("keeps __truncated for array and preview envelopes", () => {
    const arrayEnvelope = {
      items: [{ id: 1, date: "2026-08-18", title: "Heavy day" }],
      __truncated: { returned: 1, total: 10, omitted: 9, hint: "narrow" },
    };
    const previewEnvelope = {
      preview: "partial",
      __truncated: { total: 100, omitted: 93, hint: "narrow" },
    };
    expect(toolOutputSchema(athleteWorkoutsOutputSchema).parse(arrayEnvelope)).toEqual(
      arrayEnvelope,
    );
    expect(toolOutputSchema(athleteProfileOutputSchema).parse(previewEnvelope)).toEqual(
      previewEnvelope,
    );
  });
});
