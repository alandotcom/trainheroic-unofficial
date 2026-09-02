import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema1 from "../../db/migrations/0001_init.sql?raw";
import schema2 from "../../db/migrations/0002_warehouse.sql?raw";
import { MessagingStore, ProgrammingStore } from "@trainheroic-unofficial/db";
import { makeD1Warehouse } from "@trainheroic-unofficial/db/d1";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { observeD1Queries } from "./d1-query-observer";

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
    const store = new ProgrammingStore(makeD1Warehouse(env.TH_DB), client(), 7);
    const result = await store.syncCalendar(111, "Prog A");
    expect(result).toMatchObject({ sessions: 1, blocks: 1, prescribed_sets: 2 });

    const sessions = (await store.getProgramSessions(111)) as Array<{ date: string }>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.date).toBe("2026-06-22");

    const detail = (await store.getSession(9001)) as { blocks: Array<{ sets: unknown[] }> };
    expect(detail.blocks).toHaveLength(1);
    expect(detail.blocks[0]?.sets).toHaveLength(2);
  });

  it("returns a superset block's sets in prescribed exercise order, stable across re-syncs", async () => {
    const superset = {
      ...SESSION,
      sets: {
        "1": {
          id: 5001,
          order: 1,
          type: 2,
          title: "Superset",
          instruction: "",
          exercises: [
            // Listed out of order on purpose; `order` is the prescription's sequence.
            {
              order: 2,
              exercise_id: 2,
              param_1_type: 3,
              param_1_data_1: "10",
              param_1_data_2: "10",
            },
            { order: 1, exercise_id: 1, param_1_type: 3, param_1_data_1: "5", param_1_data_2: "5" },
          ],
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/1.0/coach/programs/edit/")) return json({ programWorkouts: [superset] });
        return json({});
      }),
    );
    const store = new ProgrammingStore(makeD1Warehouse(env.TH_DB), client(), 7);
    const expected = [
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ];
    for (let pass = 0; pass < 2; pass += 1) {
      await store.syncCalendar(111, "Prog A");
      const detail = (await store.getSession(9001)) as {
        blocks: Array<{ sets: Array<{ exercise_id: number; set_index: number }> }>;
      };
      expect(detail.blocks[0]?.sets.map((s) => [s.exercise_id, s.set_index])).toEqual(expected);
    }
  });

  it("is idempotent: re-sync rebuilds sets without duplicating", async () => {
    const store = new ProgrammingStore(makeD1Warehouse(env.TH_DB), client(), 7);
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
    const store = new ProgrammingStore(makeD1Warehouse(env.TH_DB), client(), 7);
    const result = await store.syncCalendar(111, "Prog A");
    expect(result.sessions).toBe(2);
    expect((await store.getProgramSessions(111)).length).toBe(2);
  });

  it("writes session blocks and prescribed sets in bounded multi-row statements", async () => {
    const session = {
      ...SESSION,
      sets: Object.fromEntries(
        Array.from({ length: 25 }, (_, index) => [
          String(index + 1),
          {
            id: 6_000 + index,
            order: index + 1,
            type: 2,
            title: `Block ${index + 1}`,
            instruction: "",
            exercises: [
              { exercise_id: index + 1, param_1_type: 3, param_1_data_1: String(index + 1) },
            ],
          },
        ]),
      ),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/1.0/coach/programs/edit/")) {
          return json({ programWorkouts: [session] });
        }
        return json({});
      }),
    );

    const observed = observeD1Queries(env.TH_DB);
    const store = new ProgrammingStore(makeD1Warehouse(observed.database), client(), 7);
    expect(await store.syncCalendar(111, "Prog A")).toMatchObject({
      blocks: 25,
      prescribed_sets: 25,
    });
    expect((await store.getSession(SESSION.id)).blocks).toHaveLength(25);

    const insertCount = (table: string) =>
      observed.queries.filter((query) => query.toLowerCase().startsWith(`insert into "${table}"`))
        .length;
    expect(insertCount("block")).toBe(4);
    expect(insertCount("prescribed_set")).toBe(4);
  });

  it("bounds stored program sessions", async () => {
    const sessions = Array.from({ length: 3 }, (_, index) => ({
      ...SESSION,
      id: SESSION.id + index,
      day: 22 + index,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/1.0/coach/programs/edit/")) {
          return json({ programWorkouts: sessions });
        }
        return json({});
      }),
    );

    const store = new ProgrammingStore(makeD1Warehouse(env.TH_DB), client(), 7);
    await store.syncCalendar(111, "Prog A");
    await env.TH_DB.batch([
      env.TH_DB.prepare(
        "INSERT INTO program_session (org_id, id, program_id, date) VALUES (7, 9004, 111, NULL)",
      ),
      env.TH_DB.prepare(
        "INSERT INTO program_session (org_id, id, program_id, date) VALUES (7, 9005, 111, NULL)",
      ),
    ]);
    const first = await store.getProgramSessions(111, 2);
    const cursor = first[1];
    if (!cursor?.date) throw new Error("Expected a dated session cursor");
    const next = await store.getProgramSessions(111, 2, {
      date: cursor.date,
      id: cursor.id,
    });
    const nullTail = await store.getProgramSessions(111, 2, {
      date: next[1]!.date,
      id: next[1]!.id,
    });
    expect(first.map((row) => row.id)).toEqual([9003, 9002]);
    expect(next.map((row) => row.id)).toEqual([9001, 9005]);
    expect(nullTail.map((row) => row.id)).toEqual([9004]);
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
    const store = new MessagingStore(makeD1Warehouse(env.TH_DB), client(), 7);
    const results = await store.syncAll();
    expect(results).toHaveLength(2);
    expect(results.reduce((a, r) => a + r.new, 0)).toBe(2);

    // The top-level comment plus its flattened reply.
    const history = (await store.history(700)) as unknown[];
    expect(history).toHaveLength(2);
  });

  it("is incremental: a second sync past the cursor adds nothing", async () => {
    stubMessaging();
    const store = new MessagingStore(makeD1Warehouse(env.TH_DB), client(), 7);
    await store.syncAll();
    const again = await store.syncStream({ id: 700, title: "Team", teamId: 10 }, "team", false);
    expect(again.new).toBe(0);
    expect((await store.history(700)) as unknown[]).toHaveLength(2);
  });

  it("full=true re-reads from the beginning past an existing cursor", async () => {
    stubMessaging();
    const store = new MessagingStore(makeD1Warehouse(env.TH_DB), client(), 7);
    // First sync establishes a cursor for stream 700.
    await store.syncAll();
    const again = await store.syncStream({ id: 700, title: "Team", teamId: 10 }, "team", true);
    // full ignores the cursor (lastCommentId=""), so the top-level comment is read again.
    expect(again.new).toBe(1);
  });

  it("loads incremental cursors in bounded 98-id chunks", async () => {
    const streams = Array.from({ length: 99 }, (_, index) => ({
      id: 1_000 + index,
      title: `Team ${index}`,
      teamId: index,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/comments")) return json([]);
        if (url.includes("/v5/messaging/streams")) {
          return json({ teams: streams, athletes: [], programs: [], coaches: [] });
        }
        return json({});
      }),
    );

    const observed = observeD1Queries(env.TH_DB);
    const warehouse = makeD1Warehouse(observed.database);

    const result = await new MessagingStore(warehouse, client(), 7).syncAll();

    expect(result).toHaveLength(99);
    expect(
      observed.queries.filter((query) => query.toLowerCase().includes('from "sync_state"')),
    ).toHaveLength(2);
  });

  it("writes message comments in bounded multi-row statements", async () => {
    const comments = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      timestamp: 1_000 + index,
      content: `Comment ${index + 1}`,
      authorName: "Coach",
      isAuthor: true,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/v5/messaging/streams/700/comments")) return json(comments);
        if (url.includes("/v5/messaging/streams")) {
          return json({
            teams: [{ id: 700, title: "Team", teamId: 10 }],
            athletes: [],
            programs: [],
            coaches: [],
          });
        }
        return json({});
      }),
    );

    const observed = observeD1Queries(env.TH_DB);
    const store = new MessagingStore(makeD1Warehouse(observed.database), client(), 7);
    expect(await store.syncAll()).toMatchObject([{ stream: 700, new: 25 }]);
    expect(await store.history(700)).toHaveLength(25);
    const first = (await store.history(700, 10)) as Array<{ id: number; ts: number }>;
    const next = (await store.history(700, 10, {
      ts: first[9]!.ts,
      id: first[9]!.id,
    })) as Array<{ id: number }>;
    expect(first.map((row) => row.id)).toEqual([25, 24, 23, 22, 21, 20, 19, 18, 17, 16]);
    expect(next.map((row) => row.id)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
    expect(
      observed.queries.filter((query) =>
        query.toLowerCase().startsWith('insert into "message_comment"'),
      ),
    ).toHaveLength(4);
  });

  it("bounds stored conversation lists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/comments")) return json([]);
        if (url.includes("/v5/messaging/streams")) {
          return json({
            teams: Array.from({ length: 5 }, (_, index) => ({
              id: 800 + index,
              title: `Team ${index}`,
              teamId: index,
              ...(index < 3 ? { lastViewed: index + 1 } : {}),
            })),
            athletes: [],
            programs: [],
            coaches: [],
          });
        }
        return json({});
      }),
    );

    const store = new MessagingStore(makeD1Warehouse(env.TH_DB), client(), 7);
    await store.syncAll();
    const first = (await store.streams(2)) as Array<{ id: number; last_viewed: number | null }>;
    const next = (await store.streams(2, {
      lastViewed: first[1]!.last_viewed,
      id: first[1]!.id,
    })) as Array<{ id: number; last_viewed: number | null }>;
    const nullTail = await store.streams(2, {
      lastViewed: next[1]!.last_viewed,
      id: next[1]!.id,
    });

    expect(first.map((row) => row.id)).toEqual([802, 801]);
    expect(next.map((row) => row.id)).toEqual([800, 804]);
    expect((nullTail as Array<{ id: number }>).map((row) => row.id)).toEqual([803]);
  });

  it("paginates from timestamped comments through a null timestamp tail", async () => {
    stubMessaging();
    const store = new MessagingStore(makeD1Warehouse(env.TH_DB), client(), 7);
    await store.syncAll();
    await env.TH_DB.batch([
      env.TH_DB.prepare(
        "INSERT INTO message_comment (org_id, id, stream_id, ts) VALUES (7, 3, 700, NULL)",
      ),
      env.TH_DB.prepare(
        "INSERT INTO message_comment (org_id, id, stream_id, ts) VALUES (7, 4, 700, NULL)",
      ),
      env.TH_DB.prepare(
        "INSERT INTO message_comment (org_id, id, stream_id, ts) VALUES (7, 6, 700, NULL)",
      ),
    ]);

    const first = (await store.history(700, 2)) as Array<{ id: number; ts: number | null }>;
    const next = (await store.history(700, 2, {
      ts: first[1]!.ts,
      id: first[1]!.id,
    })) as Array<{ id: number; ts: number | null }>;
    const nullTail = await store.history(700, 2, {
      ts: next[1]!.ts,
      id: next[1]!.id,
    });

    expect(first.map((row) => row.id)).toEqual([2, 1]);
    expect(next.map((row) => row.id)).toEqual([6, 4]);
    expect((nullTail as Array<{ id: number }>).map((row) => row.id)).toEqual([3]);
  });
});
