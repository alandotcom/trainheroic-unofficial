import { DatabaseSync } from "node:sqlite";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { AthleteTrainingStore, ExerciseStore, athletePr, exercise } from "../src/index";
import { type BatchStmt, cursorUpsertStmt } from "../src/runner";
import { syncState } from "../src/schema";
import { applyMigrations, makeSqliteWarehouse } from "../src/sqlite";

// Proves the seam: the SAME store code that runs on D1 in the worker runs on a synchronous
// node:sqlite handle through makeSqliteWarehouse — and that applyMigrations brings a fresh local
// database up to schema (and is a no-op the second time). No network: the read paths used here
// resolve the tenant id from the constructor arg, never the client.

const USER = 42;

function freshDb(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:");
  applyMigrations(sqlite);
  return sqlite;
}

describe("applyMigrations", () => {
  it("applies every pending migration once, then is a no-op", () => {
    const sqlite = new DatabaseSync(":memory:");
    const first = applyMigrations(sqlite);
    expect(first.applied).toContain("0001_init");
    expect(first.applied).toContain("0004_athlete_performed");

    const second = applyMigrations(sqlite);
    expect(second.applied).toEqual([]);

    // The tracking table records what ran, so a re-run never re-applies.
    const rows = sqlite.prepare("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number };
    expect(rows.n).toBe(first.applied.length);
  });

  it("creates the warehouse tables the migrations declare", () => {
    const sqlite = freshDb();
    const tables = (
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(tables).toContain("athlete_pr");
    expect(tables).toContain("exercise");
  });

  it("uses the unsynced queue index for ordered athlete history batches", () => {
    const sqlite = freshDb();
    const plan = sqlite
      .prepare(
        "EXPLAIN QUERY PLAN " +
          "SELECT id FROM athlete_exercise " +
          "WHERE user_id = ? AND sessions_synced_at IS NULL ORDER BY id LIMIT ?",
      )
      .all(USER, 25) as Array<{ detail: string }>;

    expect(plan.map((row) => row.detail).join("\n")).toContain("idx_aexercise_unsynced");
  });

  it("uses covering order indexes for newest-first warehouse pages", () => {
    const sqlite = freshDb();
    const queries = [
      {
        sql: "SELECT id, date FROM athlete_workout WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT ?",
        args: [USER, 100],
        index: "idx_aworkout_date",
      },
      {
        sql: "SELECT id, date FROM program_session WHERE org_id = ? AND program_id = ? ORDER BY date DESC, id DESC LIMIT ?",
        args: [7, 111, 200],
        index: "idx_psession_program",
      },
      {
        sql: "SELECT id, last_viewed FROM message_stream WHERE org_id = ? ORDER BY last_viewed DESC, id DESC LIMIT ?",
        args: [7, 50],
        index: "idx_mstream_viewed",
      },
      {
        sql: "SELECT id, ts FROM message_comment WHERE org_id = ? AND stream_id = ? ORDER BY ts DESC, id DESC LIMIT ?",
        args: [7, 700, 50],
        index: "idx_mcomment_stream",
      },
      {
        sql: "SELECT id, date FROM athlete_workout WHERE user_id = ? AND date IS NOT NULL AND (date, id) < (?, ?) ORDER BY date DESC, id DESC LIMIT ?",
        args: [USER, "2026-06-01", 10, 100],
        index: "idx_aworkout_date",
        seek: "(date,id)<(?,?)",
      },
      {
        sql: "SELECT id, date FROM program_session WHERE org_id = ? AND program_id = ? AND date IS NOT NULL AND (date, id) < (?, ?) ORDER BY date DESC, id DESC LIMIT ?",
        args: [7, 111, "2026-06-01", 20, 200],
        index: "idx_psession_program",
        seek: "(date,id)<(?,?)",
      },
      {
        sql: "SELECT id, last_viewed FROM message_stream WHERE org_id = ? AND last_viewed IS NOT NULL AND (last_viewed, id) < (?, ?) ORDER BY last_viewed DESC, id DESC LIMIT ?",
        args: [7, 100, 30, 50],
        index: "idx_mstream_viewed",
        seek: "(last_viewed,id)<(?,?)",
      },
      {
        sql: "SELECT id, ts FROM message_comment WHERE org_id = ? AND stream_id = ? AND ts IS NOT NULL AND (ts, id) < (?, ?) ORDER BY ts DESC, id DESC LIMIT ?",
        args: [7, 700, 100, 40, 50],
        index: "idx_mcomment_stream",
        seek: "(ts,id)<(?,?)",
      },
    ];

    for (const query of queries) {
      const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.args) as Array<{
        detail: string;
      }>;
      const detail = plan.map((row) => row.detail).join("\n");
      expect(detail).toContain(query.index);
      expect(detail).not.toContain("USE TEMP B-TREE");
      if ("seek" in query) expect(detail).toContain(query.seek);
    }
  });
});

describe("a store on the node:sqlite driver", () => {
  it("writes through the atomic exec and reads back via the store", async () => {
    const sqlite = freshDb();
    const wh = makeSqliteWarehouse(sqlite);

    // Write two PR rows for one exercise through the injected atomic-batch executor (the
    // node:sqlite BEGIN/COMMIT path), using the shared Drizzle insert builders.
    await wh.exec([
      wh.db.insert(athletePr).values({
        userId: USER,
        exerciseId: 424,
        reps: 5,
        weight: 335,
        units: "lb",
        date: "2026-05-01",
      }),
      wh.db.insert(athletePr).values({
        userId: USER,
        exerciseId: 424,
        reps: 3,
        weight: 355,
        units: "lb",
        date: "2026-06-01",
      }),
    ]);

    const store = new AthleteTrainingStore(wh, new TrainHeroicClient("a@b.com", "pw"), USER);
    const prs = (await store.prs(424)) as Array<{ reps: number; weight: number }>;
    expect(prs).toHaveLength(2);
    expect(prs.map((p) => p.weight).sort((a, b) => a - b)).toEqual([335, 355]);
  });

  it("rolls back the whole group when one statement in the exec fails", async () => {
    const sqlite = freshDb();
    const wh = makeSqliteWarehouse(sqlite);

    await expect(
      wh.exec([
        wh.db.insert(athletePr).values({ userId: USER, exerciseId: 1, reps: 1, weight: 100 }),
        // Second statement violates NOT NULL on exercise_id, so the BEGIN/COMMIT bracket aborts.
        wh.db
          .insert(athletePr)
          .values({ userId: USER, exerciseId: null as unknown as number, reps: 1, weight: 1 }),
      ]),
    ).rejects.toThrow();

    const store = new AthleteTrainingStore(wh, new TrainHeroicClient("a@b.com", "pw"), USER);
    expect(await store.prs(1)).toHaveLength(0);
  });
});

describe("cursorUpsertStmt", () => {
  it("leaves a field the caller omits untouched on an existing row", async () => {
    const sqlite = freshDb();
    const wh = makeSqliteWarehouse(sqlite);
    await wh.exec([cursorUpsertStmt(wh.db, 7, "messaging", 55, { cursor: "9001" })]);
    // A generation-only bump (the library sync's shape) must not wipe the cursor.
    await wh.exec([cursorUpsertStmt(wh.db, 7, "messaging", 55, { generation: 2 })]);
    const row = await wh.db
      .select({ cursor: syncState.cursor, generation: syncState.generation })
      .from(syncState)
      .where(and(eq(syncState.orgId, 7), eq(syncState.scopeId, 55)))
      .get();
    expect(row).toEqual({ cursor: "9001", generation: 2 });
  });
});

describe("makeSqliteWarehouse exec", () => {
  it("queues store writes behind an unrelated transaction so its rollback cannot undo them", async () => {
    const sqlite = freshDb();
    const wh = makeSqliteWarehouse(sqlite);
    const client = new TrainHeroicClient("a@b.com", "pw");
    const store = new ExerciseStore(wh, client, 7);
    await wh.exec([
      wh.db.insert(exercise).values({
        orgId: 7,
        id: 101,
        title: "Temporary",
        searchText: "temporary",
        raw: "{}",
        generation: 1,
      }),
    ]);

    let signalBegun: () => void = () => {};
    const begun = new Promise<void>((resolve) => {
      signalBegun = resolve;
    });
    let releaseBarrier: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const pausedStatement = {
      then(resolve: () => void): void {
        signalBegun();
        void barrier.then(resolve);
      },
    } as BatchStmt;
    const group = wh.exec([
      pausedStatement,
      wh.db
        .insert(athletePr)
        .values({ userId: USER, exerciseId: null as unknown as number, reps: 1, weight: 1 }),
    ]);
    const rejected = expect(group).rejects.toThrow();
    await begun;

    let deleteSettled = false;
    const deletion = store.recordDelete(101).then(() => {
      deleteSettled = true;
    });
    await Promise.resolve();
    const whilePaused = sqlite
      .prepare("SELECT COUNT(*) AS n FROM exercise WHERE org_id = 7 AND id = 101")
      .get() as { n: number };
    expect(deleteSettled).toBe(false);
    expect(whilePaused.n).toBe(1);

    releaseBarrier();
    await rejected;
    await deletion;
    const after = sqlite
      .prepare("SELECT COUNT(*) AS n FROM exercise WHERE org_id = 7 AND id = 101")
      .get() as { n: number };

    expect(after.n).toBe(0);
  });

  it("serializes concurrent groups on the one connection instead of nesting transactions", async () => {
    const sqlite = freshDb();
    const wh = makeSqliteWarehouse(sqlite);
    const group = (exerciseId: number) => [
      wh.db.insert(athletePr).values({ userId: USER, exerciseId, reps: 1, weight: 100 }),
      wh.db.insert(athletePr).values({ userId: USER, exerciseId, reps: 2, weight: 90 }),
    ];
    // Without queuing, the second BEGIN lands inside the first bracket (the executor awaits
    // between statements) and SQLite rejects it.
    await Promise.all([wh.exec(group(1)), wh.exec(group(2)), wh.exec(group(3))]);
    const store = new AthleteTrainingStore(wh, new TrainHeroicClient("a@b.com", "pw"), USER);
    expect(await store.prs(1)).toHaveLength(2);
    expect(await store.prs(2)).toHaveLength(2);
    expect(await store.prs(3)).toHaveLength(2);
  });

  it("keeps running queued groups after an earlier group rolled back", async () => {
    const sqlite = freshDb();
    const wh = makeSqliteWarehouse(sqlite);
    const bad = wh.exec([
      wh.db
        .insert(athletePr)
        .values({ userId: USER, exerciseId: null as unknown as number, reps: 1, weight: 1 }),
    ]);
    const good = wh.exec([
      wh.db.insert(athletePr).values({ userId: USER, exerciseId: 9, reps: 1, weight: 100 }),
    ]);
    await expect(bad).rejects.toThrow();
    await good;
    const store = new AthleteTrainingStore(wh, new TrainHeroicClient("a@b.com", "pw"), USER);
    expect(await store.prs(9)).toHaveLength(1);
  });
});
