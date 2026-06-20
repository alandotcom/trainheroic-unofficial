import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_warehouse.sql?raw";
import { MessagingStore } from "../src/store/messaging";
import { ProgrammingStore } from "../src/store/programming";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function statements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applySchema(): Promise<void> {
  await env.TH_DB.batch(
    [...statements(schema1), ...statements(schema2)].map((s) => env.TH_DB.prepare(s)),
  );
}

function client(): TrainHeroicClient {
  return new TrainHeroicClient("a@b.com", "pw");
}

beforeEach(async () => {
  await applySchema();
  await env.TH_DB.batch(
    [
      "program",
      "program_session",
      "block",
      "prescribed_set",
      "message_stream",
      "message_comment",
      "sync_state",
    ].map((t) => env.TH_DB.prepare(`DELETE FROM ${t}`)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SESSION = {
  id: 9001,
  year: 2026,
  month: 6,
  day: 22,
  title: "Day 1",
  published: 1,
  timeline_day: 0,
  sets: {
    "1": {
      id: 5001,
      order: 1,
      type: 2,
      title: "Primary",
      instruction: "",
      exercises: [
        {
          exercise_id: 1,
          param_1_type: 3,
          param_2_type: 1,
          param_1_data_1: "5",
          param_1_data_2: "5",
          param_2_data_1: "185",
          param_2_data_2: "205",
        },
      ],
    },
  },
};

describe("ProgrammingStore", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/1.0/coach/programs/edit/")) return json({ programWorkouts: [SESSION] });
        if (url.includes("/1.0/coach/programs")) return json([{ id: 111, title: "Prog A" }]);
        if (url.includes("/1.0/coach/teams")) return json([]);
        return json({});
      }),
    );
  });

  it("syncs a calendar into sessions, blocks, and sets", async () => {
    const store = new ProgrammingStore(env.TH_DB, client(), 7);
    const result = await store.syncCalendar(111, "Prog A");
    expect(result).toMatchObject({ sessions: 1, blocks: 1, prescribed_sets: 2 });

    const sessions = (await store.getProgramSessions(111)) as Array<{ date: string }>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.date).toBe("2026-06-22");

    const detail = (await store.getSession(9001)) as { blocks: Array<{ sets: unknown[] }> };
    expect(detail.blocks).toHaveLength(1);
    expect(detail.blocks[0]?.sets).toHaveLength(2);
  });

  it("is idempotent: re-sync rebuilds sets without duplicating", async () => {
    const store = new ProgrammingStore(env.TH_DB, client(), 7);
    await store.syncCalendar(111, "Prog A");
    await store.syncCalendar(111, "Prog A");
    const detail = (await store.getSession(9001)) as { blocks: Array<{ sets: unknown[] }> };
    expect(detail.blocks[0]?.sets).toHaveLength(2);
  });

  it("syncs multiple sessions in one calendar (atomic per-session groups)", async () => {
    const second = {
      id: 9002,
      year: 2026,
      month: 6,
      day: 23,
      title: "Day 2",
      published: 0,
      sets: {
        "1": {
          id: 5002,
          order: 1,
          type: 2,
          title: "Accessory",
          instruction: "",
          exercises: [{ exercise_id: 2, param_1_type: 3, param_1_data_1: "8" }],
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/1.0/coach/programs/edit/"))
          return json({ programWorkouts: [SESSION, second] });
        if (url.includes("/1.0/coach/programs")) return json([{ id: 111, title: "Prog A" }]);
        if (url.includes("/1.0/coach/teams")) return json([]);
        return json({});
      }),
    );
    const store = new ProgrammingStore(env.TH_DB, client(), 7);
    const result = await store.syncCalendar(111, "Prog A");
    expect(result.sessions).toBe(2);
    expect((await store.getProgramSessions(111)).length).toBe(2);
  });
});

describe("MessagingStore", () => {
  function stubMessaging(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/v5/messaging/streams/700/comments")) {
          const last = new URL(url).searchParams.get("lastCommentId");
          if (last) return json([]);
          return json([
            {
              id: 1,
              timestamp: 100,
              content: "hi",
              authorName: "Coach",
              isAuthor: true,
              replies: [{ id: 2, timestamp: 101, content: "re", authorName: "Ath" }],
            },
          ]);
        }
        if (url.includes("/v5/messaging/streams/701/comments"))
          return json([{ id: 5, timestamp: 200, content: "yo" }]);
        if (url.includes("/v5/messaging/streams")) {
          return json({
            teams: [{ id: 700, title: "Team", teamId: 10 }],
            athletes: [{ id: 701, title: "Athlete", userId: 20 }],
            programs: [],
            coaches: [],
          });
        }
        return json({});
      }),
    );
  }

  it("syncs streams and flattens replies, then reads history", async () => {
    stubMessaging();
    const store = new MessagingStore(env.TH_DB, client(), 7);
    const results = await store.syncAll();
    expect(results).toHaveLength(2);
    expect(results.reduce((a, r) => a + r.new, 0)).toBe(2);

    // The top-level comment plus its flattened reply.
    const history = (await store.history(700)) as unknown[];
    expect(history).toHaveLength(2);
  });

  it("is incremental: a second sync past the cursor adds nothing", async () => {
    stubMessaging();
    const store = new MessagingStore(env.TH_DB, client(), 7);
    await store.syncAll();
    const again = await store.syncStream({ id: 700, title: "Team", teamId: 10 }, "team", false);
    expect(again.new).toBe(0);
    expect((await store.history(700)) as unknown[]).toHaveLength(2);
  });
});
