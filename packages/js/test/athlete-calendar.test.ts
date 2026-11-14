import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "../src/client";
import {
  CoachMonthSummaryError,
  fetchCoachAthleteCalendar,
  fetchCoachAthleteCalendarSummary,
  resolveBuildProgramId,
} from "../src/coach-athlete-calendar";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCoachAthleteCalendar", () => {
  it("GETs /v5/calendars/athletes/{id}?year=&month= and returns programId", async () => {
    let calledUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        calledUrl = url;
        return json({
          id: 5060391,
          title: "[Demo] Sarah Anderson",
          type: 5,
          group_id: 5024764,
        });
      }),
    );
    const cal = await fetchCoachAthleteCalendar(
      new TrainHeroicClient("a@b.com", "pw"),
      2897391,
      2026,
      8,
    );
    expect(calledUrl).toContain("/v5/calendars/athletes/2897391?year=2026&month=8");
    expect(cal).toEqual({
      programId: 5060391,
      title: "[Demo] Sarah Anderson",
      type: 5,
      groupId: 5024764,
    });
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        return json("Invalid parameters", 400);
      }),
    );
    await expect(
      fetchCoachAthleteCalendar(new TrainHeroicClient("a@b.com", "pw"), 1, 2026, 8),
    ).rejects.toThrow(/HTTP 400/u);
  });
});

describe("resolveBuildProgramId", () => {
  it("returns programId when given explicitly", async () => {
    const id = await resolveBuildProgramId(new TrainHeroicClient("a@b.com", "pw"), {
      programId: 42,
    });
    expect(id).toBe(42);
  });

  it("rejects both programId and athleteId", async () => {
    await expect(
      resolveBuildProgramId(new TrainHeroicClient("a@b.com", "pw"), {
        programId: 1,
        athleteId: 2,
      }),
    ).rejects.toThrow(/not both/u);
  });

  it("rejects neither", async () => {
    await expect(resolveBuildProgramId(new TrainHeroicClient("a@b.com", "pw"), {})).rejects.toThrow(
      /Provide programId/u,
    );
  });

  it("resolves athleteId via calendar fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        return json({ id: 5060391, title: "Sarah", type: 5, group_id: 1 });
      }),
    );
    const id = await resolveBuildProgramId(new TrainHeroicClient("a@b.com", "pw"), {
      athleteId: 2897391,
      date: "2026-8-26",
    });
    expect(id).toBe(5060391);
  });
});

describe("fetchCoachAthleteCalendarSummary", () => {
  function client(response: Response): TrainHeroicClient {
    return new TrainHeroicClient("a@b.com", "pw", "live-session", {
      transport: vi.fn(async () => response),
    });
  }

  it("raises an HTTP 500 as a typed error that points at the date-range read", async () => {
    const read = fetchCoachAthleteCalendarSummary(
      client(json({ message: "Server Error" }, 500)),
      7,
      2026,
      6,
    );
    await expect(read).rejects.toBeInstanceOf(CoachMonthSummaryError);
    await expect(read).rejects.toMatchObject({ status: 500 });
    await expect(read).rejects.toThrow(
      /athlete 7 in 2026-06 failed \(HTTP 500\): Server Error\. .*date-range read/u,
    );
  });

  it("reports a successful response that is not a row list as an unexpected shape", async () => {
    await expect(
      fetchCoachAthleteCalendarSummary(client(json({ unexpected: true })), 7, 2026, 11),
    ).rejects.toThrow(/athlete 7 in 2026-11 returned an unexpected response shape\./u);
  });
});
