import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "../src/client";
import { queryAnalytics, teamVolume } from "../src/coach";

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
  it("batches large training-summary queries and merges their rows", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let active = 0;
    let peak = 0;
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      active += 1;
      peak = Math.max(peak, active);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      await Promise.resolve();
      active -= 1;
      return json({
        title: "Training Summary",
        columns: ["user_id"],
        rows: [{ users: body.user_ids, start: body.date_start, end: body.date_end }],
      });
    });
    const result = (await queryAnalytics(
      new TrainHeroicClient("a@b.com", "pw", "live-session", { transport }),
      {
        metric: "training-summary-athlete",
        userIds: [1, 2, 3, 4, 5, 1, 6, 7],
        dateStart: "2026-01-01",
        dateEnd: "2026-04-30",
      },
    )) as { title: string; columns: string[]; rows: unknown[] };

    expect(bodies).toHaveLength(4);
    expect(bodies.every((body) => (body.user_ids as unknown[]).length <= 5)).toBe(true);
    for (const start of new Set(bodies.map((body) => body.date_start))) {
      const users = bodies
        .filter((body) => body.date_start === start)
        .flatMap((body) => body.user_ids as string[]);
      expect(new Set(users).size).toBe(users.length);
    }
    expect(result).toMatchObject({ title: "Training Summary", columns: ["user_id"] });
    expect(result.rows).toHaveLength(4);
    expect(peak).toBe(1);
  });

  it("uses deduplicated user ids when one batch covers the request", async () => {
    let body: Record<string, unknown> | undefined;
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return json({ rows: [] });
    });

    await queryAnalytics(new TrainHeroicClient("a@b.com", "pw", "live-session", { transport }), {
      metric: "training-summary-athlete",
      userIds: [11, 11, 22],
      dateStart: "2026-06-01",
      dateEnd: "2026-06-30",
    });

    expect(body?.user_ids).toEqual(["11", "22"]);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("rejects a training summary that would create too many requests", async () => {
    const transport = vi.fn(async () => json({ rows: [] }));

    await expect(
      queryAnalytics(new TrainHeroicClient("a@b.com", "pw", "live-session", { transport }), {
        metric: "training-summary-athlete",
        userIds: Array.from({ length: 501 }, (_, i) => i + 1),
        dateStart: "2026-06-01",
        dateEnd: "2026-06-30",
      }),
    ).rejects.toThrow(/limited to 100 batched requests/u);
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects a training summary date range spanning more than 100 windows", async () => {
    const transport = vi.fn(async () => json({ rows: [] }));

    await expect(
      queryAnalytics(new TrainHeroicClient("a@b.com", "pw", "live-session", { transport }), {
        metric: "training-summary-athlete",
        userIds: [1],
        dateStart: "1900-01-01",
        dateEnd: "2026-06-30",
      }),
    ).rejects.toThrow(/limited to 100 windows/u);
    expect(transport).not.toHaveBeenCalled();
  });

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
