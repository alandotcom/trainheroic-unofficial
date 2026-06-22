import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { AthleteTrainingStore, athletePr } from "../src/index";
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
