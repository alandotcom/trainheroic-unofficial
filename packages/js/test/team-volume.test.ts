import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "../src/client";
import { teamVolume } from "../src/coach";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPORT = {
  title: "Training Summary",
  columns: [],
  rows: [
    {
      user_id: 11,
      name_first: "Ann",
      name_last: "Lee",
      date_completed: "2026-06-20",
      reps: 25,
      volume: 7000,
    },
    {
      user_id: 11,
      name_first: "Ann",
      name_last: "Lee",
      date_completed: "2026-06-22",
      reps: 15,
      volume: 3000,
    },
    {
      user_id: 22,
      name_first: "Bo",
      name_last: "Cole",
      date_completed: "2026-06-21",
      reps: 10,
      volume: 5000,
    },
  ],
};

describe("teamVolume", () => {
  it("groups sessions by athlete, sums volume/reps, and rolls up totals", async () => {
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/v5/analytics/training-summary/users")) {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return json(REPORT);
        }
        return json({});
      }),
    );
    const report = await teamVolume(new TrainHeroicClient("a@b.com", "pw"), {
      athleteIds: [11, 22],
      dateStart: "2026-06-15",
      dateEnd: "2026-06-28",
    });

    expect(body?.user_ids).toEqual(["11", "22"]);
    expect(body?.date_start).toBe("2026-06-15");
    // Sorted by volume desc: Ann (10000) before Bo (5000).
    expect(report.athletes.map((a) => a.athleteId)).toEqual([11, 22]);
    const ann = report.athletes[0];
    expect(ann).toMatchObject({
      athleteId: 11,
      name: "Ann Lee",
      sessions: 2,
      reps: 40,
      volume: 10000,
      firstLoggedDate: "2026-06-20",
      lastLoggedDate: "2026-06-22",
    });
    expect(report.totals).toEqual({ athletes: 2, sessions: 3, reps: 50, volume: 15000 });
    expect(report.window).toEqual({ start: "2026-06-15", end: "2026-06-28" });
  });

  it("returns empty athletes and zero totals when no one logged in range", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/auth") ? json({ id: 1, session_id: "s" }) : json({ rows: [] }),
      ),
    );
    const report = await teamVolume(new TrainHeroicClient("a@b.com", "pw"), {
      athleteIds: [11],
      dateStart: "2026-06-15",
      dateEnd: "2026-06-28",
    });
    expect(report.athletes).toEqual([]);
    expect(report.totals).toEqual({ athletes: 0, sessions: 0, reps: 0, volume: 0 });
  });

  it("rejects an empty athlete list before calling the API", async () => {
    await expect(
      teamVolume(new TrainHeroicClient("a@b.com", "pw"), {
        athleteIds: [],
        dateStart: "2026-06-15",
        dateEnd: "2026-06-28",
      }),
    ).rejects.toThrow(/at least one athleteId/u);
  });
});
