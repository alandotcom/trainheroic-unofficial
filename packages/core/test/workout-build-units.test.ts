import { describe, expect, it, vi } from "vitest";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { ToolContext } from "../src/context";
import { registerWorkoutTools } from "../src/tools/workout";

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };
type Handler = (args: Record<string, unknown>, ctx: ServerContext) => Promise<ToolResult>;

function buildHandler(param1: number | null, param2: number | null) {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler),
  } as unknown as McpServer;
  const request = vi.fn();
  const ctx = {
    client: { request },
    index: {
      currentDefaultsMany: async () => new Map([[1, { param1, param2 }]]),
    },
  } as unknown as ToolContext;
  registerWorkoutTools(server, ctx);
  const handler = handlers.get("workout_build");
  expect(handler).toBeDefined();
  return { handler: handler!, request };
}

describe("workout_build unit validation", () => {
  it.each([
    {
      name: "a unit that conflicts with an explicit param type",
      values: { reps: 200, primaryUnit: "m", param_1_type: 10 },
      param1: 10,
      param2: 0,
      expected: /primaryUnit m conflicts with param_1_type 10 \(mi\)/u,
    },
    {
      name: "a unit that names two param types",
      values: { weight: 30, secondaryUnit: "sec" },
      param1: 3,
      param2: 1,
      expected: /secondaryUnit sec matches .*set param_2_type/u,
    },
    {
      name: "an unknown unit",
      values: { weight: 30, secondaryUnit: "stone" },
      param1: 3,
      param2: 1,
      expected: /unknown unit 'stone'/u,
    },
  ])("rejects $name before writing a draft", async ({ values, param1, param2, expected }) => {
    const { handler, request } = buildHandler(param1, param2);
    const result = await handler(
      {
        programId: 5,
        date: "2026-6-22",
        blocks: [{ title: "Conditioning", exercises: [{ id: 1, ...values }] }],
      },
      {} as ServerContext,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(expected);
    expect(request).not.toHaveBeenCalled();
  });
});
