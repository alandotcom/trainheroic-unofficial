/**
 * Regression for Durable Object OOM during exercise library refresh
 * (Sentry TRAINHEROIC-MCP-K): ExerciseStore.refresh() must not materialize one
 * giant statement array for a large library.
 *
 * Red signal: syncDeltaMb for 8k exercises exceeds the DO headroom budget.
 * Run: pnpm exec vitest run test/memory-probe.test.ts
 */
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { ExerciseStore } from "../src/index";
import { applyMigrations, makeSqliteWarehouse } from "../src/sqlite";

function heapUsed(): number {
  return process.memoryUsage().heapUsed;
}

function mb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exercise library refresh memory", () => {
  it("keeps an 8k-library refresh well under the 128 MB DO isolate budget", async () => {
    const n = 8000;
    global.gc?.();
    const sqlite = new DatabaseSync(":memory:");
    applyMigrations(sqlite);
    const wh = makeSqliteWarehouse(sqlite);
    const list = Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      title: `Exercise ${i}`,
      param_1_type: 1,
      param_2_type: 2,
      can_edit: 1,
      user_id: 1,
      use_count: i,
      video_url: `https://example.com/v/${i}`,
      description: "d".repeat(120),
    }));

    const client = new TrainHeroicClient("a@b.com", "pw");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.endsWith("/auth")) {
          return new Response(JSON.stringify({ id: 1, session_id: "sess" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (u.includes("exerciseLibrary")) {
          return new Response(JSON.stringify(list), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (u.includes("/user/simple")) {
          return new Response(JSON.stringify({ org_id: 7 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const store = new ExerciseStore(wh, client, 7);
    const mid = heapUsed();
    const result = await store.refresh();
    const after = heapUsed();
    const syncDeltaMb = mb(after - mid);

    expect(result.synced).toBe(n);
    // Leave headroom under the 128 MB isolate for the MCP SDK, tool schemas, and Sentry.
    expect(syncDeltaMb).toBeLessThan(64);
  }, 120_000);
});
