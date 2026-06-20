import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schemaSql from "../migrations/0001_init.sql?raw";
import { ExerciseStore } from "../src/store/exercises";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockApi(library: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
      if (url.includes("/v5/exerciseLibrary/all")) return json(library);
      if (url.includes("/2.0/coach/exercise/create"))
        return json({ success: 1, data: { id: 555, title: "Made", param_1_type: 3 } });
      return json({});
    }),
  );
}

function newStore(org = 7): ExerciseStore {
  return new ExerciseStore(env.TH_DB, new TrainHeroicClient("a@b.com", "pw"), org);
}

async function applySchema(): Promise<void> {
  const statements = schemaSql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  await env.TH_DB.batch(statements.map((stmt) => env.TH_DB.prepare(stmt)));
}

beforeEach(async () => {
  await applySchema();
  await env.TH_DB.batch([
    env.TH_DB.prepare("DELETE FROM exercise"),
    env.TH_DB.prepare("DELETE FROM sync_meta"),
    env.TH_DB.prepare("DELETE FROM sync_state"),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExerciseStore refresh + reads", () => {
  beforeEach(() => {
    mockApi([
      { id: 1, title: "Back Squat", param_1_type: 3, param_2_type: 1 },
      { id: 1162, title: "Bench Press", param_1_type: 3, param_2_type: 1 },
      { id: 903, title: "Dips", param_1_type: 3, param_2_type: 0, can_edit: 1 },
    ]);
  });

  it("syncs the library and resolves with units", async () => {
    const store = newStore();
    expect((await store.refresh()).synced).toBe(3);

    const resolved = await store.resolve("Back Squat");
    expect(resolved.match?.id).toBe(1);
    expect(resolved.match?.units).toEqual(["reps", "lb"]);
  });

  it("searches by token and returns full objects from get", async () => {
    const store = newStore();
    await store.refresh();

    const hits = await store.search("press");
    expect(hits.some((e) => e.id === 1162)).toBe(true);

    const ex = await store.get(1162);
    expect(ex?.title).toBe("Bench Press");
    expect(ex?.units).toEqual(["reps", "lb"]);
    expect(ex).not.toHaveProperty("param_1_type");
    expect(ex).not.toHaveProperty("param_2_type");
  });
});

describe("ExerciseStore safety + write-through", () => {
  it("refuses to wipe the mirror on an empty response", async () => {
    mockApi([]);
    await expect(newStore().refresh()).rejects.toThrow(/no rows/u);
  });

  it("prunes rows missing from a full re-sync (above the floor)", async () => {
    const gen1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      title: `Ex ${i + 1}`,
      param_1_type: 3,
    }));
    mockApi(gen1);
    const store = newStore();
    await store.refresh();

    const gen2 = [
      ...gen1.filter((e) => e.id !== 100),
      { id: 200, title: "Ex 200", param_1_type: 3 },
    ];
    mockApi(gen2);
    const result = await store.refresh();

    expect(result.pruned).toBe(1);
    expect(await store.get(100)).toBeNull();
    expect(await store.get(200)).not.toBeNull();
  });

  it("does NOT prune when a full re-sync returns fewer than the floor", async () => {
    const gen1 = Array.from({ length: 120 }, (_, i) => ({
      id: i + 1,
      title: `Ex ${i + 1}`,
      param_1_type: 3,
    }));
    mockApi(gen1);
    const store = newStore();
    await store.refresh();

    // A degraded response (30 rows, below PRUNE_FLOOR) must not wipe the other 90.
    const partial = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      title: `Ex ${i + 1}`,
      param_1_type: 3,
    }));
    mockApi(partial);
    const result = await store.refresh();

    expect(result.pruned).toBe(0);
    // A row only present in the first (full) sync still resolves.
    expect(await store.get(100)).not.toBeNull();
  });

  it("write-through upserts and forgets a single exercise", async () => {
    mockApi([{ id: 1, title: "Back Squat", param_1_type: 3 }]);
    const store = newStore();
    await store.refresh();

    await store.recordUpsert({ id: 999, title: "Custom Move", param_1_type: 3, can_edit: 1 });
    expect((await store.get(999))?.title).toBe("Custom Move");

    await store.recordDelete(999);
    expect(await store.get(999)).toBeNull();
  });

  it("returns no match when the name is ambiguous", async () => {
    mockApi([
      { id: 1, title: "Incline Bench Press", param_1_type: 3 },
      { id: 2, title: "Decline Bench Press", param_1_type: 3 },
    ]);
    const store = newStore();
    await store.refresh();

    const resolved = await store.resolve("bench press");
    expect(resolved.match).toBeNull();
    expect(resolved.candidates.length).toBeGreaterThan(1);
  });

  it("scopes rows by org", async () => {
    mockApi([{ id: 1, title: "Back Squat", param_1_type: 3 }]);
    await newStore(7).refresh();
    const other = await env.TH_DB.prepare(
      "SELECT COUNT(*) AS n FROM exercise WHERE org_id = 8",
    ).first<{ n: number }>();
    expect(other?.n).toBe(0);
  });
});
