import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import schema1 from "../../db/migrations/0001_init.sql?raw";
import schema2 from "../../db/migrations/0002_warehouse.sql?raw";
import schema3 from "../../db/migrations/0003_athlete.sql?raw";
import schema4 from "../../db/migrations/0004_athlete_performed.sql?raw";
import { makeD1Warehouse } from "@trainheroic-unofficial/db/d1";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { registerAthleteSyncTools } from "../src/tools/athlete-sync";
import { registerSyncTools } from "../src/tools/sync";

type ToolResult = { isError?: boolean };
type Handler = (args: Record<string, unknown>, ctx: ServerContext) => Promise<ToolResult>;

function statements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function harness(): { server: McpServer; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      handlers.set(name, handler);
      return {};
    },
  } as unknown as McpServer;
  return { server, handlers };
}

const client = new TrainHeroicClient("a@b.com", "pw");
const context = {} as ServerContext;

beforeEach(async () => {
  for (const sql of [
    ...statements(schema1),
    ...statements(schema2),
    ...statements(schema3),
    ...statements(schema4),
  ]) {
    try {
      await env.TH_DB.prepare(sql).run();
    } catch (error) {
      if (!String(error).includes("duplicate column")) throw error;
    }
  }
  await env.TH_DB.batch([
    env.TH_DB.prepare("DELETE FROM athlete_workout"),
    env.TH_DB.prepare("DELETE FROM program_session"),
    env.TH_DB.prepare(
      "INSERT INTO athlete_workout (user_id, id, date, logged) VALUES (42, 10, '2026-01-01', 0)",
    ),
    env.TH_DB.prepare(
      "INSERT INTO program_session (org_id, id, program_id, date) VALUES (7, 20, 30, '2026-01-01')",
    ),
  ]);
});

describe("warehouse stored-tool routing", () => {
  it("rejects a workout list cursor in workout-detail mode", async () => {
    const { server, handlers } = harness();
    registerAthleteSyncTools(server, makeD1Warehouse(env.TH_DB), client, 42);

    const result = await handlers.get("athlete_workouts_stored")!(
      { workoutId: 10, before: { date: "2026-01-01", workoutId: 10 } },
      context,
    );

    expect(result.isError).toBe(true);
  });

  it("rejects ambiguous programming selectors and detail cursors", async () => {
    const { server, handlers } = harness();
    registerSyncTools(server, makeD1Warehouse(env.TH_DB), client, 7);
    const stored = handlers.get("programming_stored")!;

    expect((await stored({ programId: 30, sessionId: 20 }, context)).isError).toBe(true);
    expect(
      (await stored({ sessionId: 20, before: { date: "2026-01-01", sessionId: 20 } }, context))
        .isError,
    ).toBe(true);
  });
});
