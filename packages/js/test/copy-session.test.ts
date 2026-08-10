import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "../src/client";
import { copySession } from "../src/coach";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copySession", () => {
  it("sends the explicit null timeline destination required for a date copy", async () => {
    let body: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.endsWith("/2.0/coach/calendar/copyProgramWorkout")) {
          body = JSON.parse(String(init?.body));
          return json({ id: 30 });
        }
        return json({});
      }),
    );

    await copySession(new TrainHeroicClient("a@b.com", "pw"), {
      toProgramId: 5064867,
      pwId: 155564797,
      toDate: "2026-9-12",
    });

    expect(body).toEqual({
      toProgramId: 5064867,
      pwId: 155564797,
      toDate: {
        date: "2026-09-12",
        day: 12,
        month: 9,
        year: 2026,
        dayOfWeek: 6,
        isToday: false,
      },
      toTimelineDate: null,
    });
  });
});
