import { describe, expect, it, vi } from "vitest";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { ClientResult, ExerciseDefaults } from "@trainheroic-unofficial/js";
import type { ToolContext } from "../src/context";
import { registerAnalyticsTools } from "../src/tools/analytics";

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };
type Handler = (args: Record<string, unknown>, ctx: ServerContext) => Promise<ToolResult>;

// A library mirror holding one lift and one loaded carry, keyed by id.
const LIBRARY: Record<number, { title: string; units: string[]; defaults: ExerciseDefaults }> = {
  1: { title: "Back Squat", units: ["reps", "lb"], defaults: { param1: 3, param2: 1 } },
  5947406: {
    title: "KB Farmer's Walk",
    units: ["ft", "lb"],
    defaults: { param1: 11, param2: 1 },
  },
};

function analyticsHandler(request: (method: string, path: string) => Promise<ClientResult>) {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (tool: string, _config: unknown, handler: Handler) => handlers.set(tool, handler),
  } as unknown as McpServer;
  const index = {
    defaultsMany: async (ids: readonly number[]) =>
      new Map(ids.flatMap((id) => (LIBRARY[id] ? [[id, LIBRARY[id].defaults] as const] : []))),
    get: async (id: number) =>
      LIBRARY[id] ? { id, title: LIBRARY[id].title, units: LIBRARY[id].units } : null,
  };
  const client = { request } as unknown as ToolContext["client"];
  registerAnalyticsTools(server, { client, index } as unknown as ToolContext);
  return handlers.get("analytics_query")!;
}

const RANGE = { userIds: [11], dateStart: "2026-10-01", dateEnd: "2026-11-14" };

describe("analytics_query exercise check", () => {
  it("answers a mirrored exercise the lift reports reject without calling TrainHeroic", async () => {
    const request = vi.fn(async () => ({ ok: true, status: 200, data: { rows: [] } }));
    const handler = analyticsHandler(request);

    const result = await handler(
      { metric: "lift-1rm-history", exerciseId: 5947406, ...RANGE },
      {} as ServerContext,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(
      /cannot chart "KB Farmer's Walk" \(id 5947406, units \["ft","lb"\]\)/u,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("queries TrainHeroic for a lift and for an id missing from the mirror", async () => {
    const request = vi.fn(async () => ({ ok: true, status: 200, data: { rows: [] } }));
    const handler = analyticsHandler(request);

    const lift = await handler(
      { metric: "lift-1rm-history", exerciseId: 1, ...RANGE },
      {} as ServerContext,
    );
    const unmirrored = await handler(
      { metric: "working-max-history", exerciseId: 999, ...RANGE },
      {} as ServerContext,
    );

    expect(lift.isError).not.toBe(true);
    expect(unmirrored.isError).not.toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
