import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAthleteTools } from "../src/tools/athletes";
import type { ToolContext } from "../src/context";

type Handler = (
  args: Record<string, unknown>,
  extra: { requestId?: string },
) => Promise<{
  isError?: boolean;
}>;

/** A fake McpServer that captures registered tool handlers and stubs elicitation. */
function harness(elicit: () => Promise<unknown>) {
  const handlers = new Map<string, Handler>();
  const server = {
    server: { elicitInput: elicit },
    registerTool: (name: string, _cfg: unknown, handler: Handler) => handlers.set(name, handler),
  } as unknown as McpServer;
  return { server, handlers };
}

function ctx(onRequest: () => void): ToolContext {
  const client = {
    request: async () => {
      onRequest();
      return { ok: true, status: 200, data: { done: true } };
    },
  };
  return { client, index: {} } as unknown as ToolContext;
}

// athlete_archive is a representative gated mutation (PUT). It exercises the shared
// confirmGate wiring that every destructive tool depends on.
describe("the destructive gate is wired into the handler", () => {
  it("blocks the PUT when elicitation is declined and never calls the API", async () => {
    let called = false;
    const { server, handlers } = harness(async () => ({ action: "decline" }));
    registerAthleteTools(
      server,
      ctx(() => {
        called = true;
      }),
    );
    const handler = handlers.get("athlete_archive");
    expect(handler).toBeDefined();
    const res = await handler!({ athleteIds: [123] }, { requestId: "r1" });
    expect(res.isError).toBe(true);
    expect(called).toBe(false);
  });

  it("calls the API once elicitation is accepted", async () => {
    let called = false;
    const { server, handlers } = harness(async () => ({
      action: "accept",
      content: { confirm: true },
    }));
    registerAthleteTools(
      server,
      ctx(() => {
        called = true;
      }),
    );
    const res = await handlers.get("athlete_archive")!({ athleteIds: [123] }, { requestId: "r1" });
    expect(called).toBe(true);
    expect(res.isError).toBeUndefined();
  });
});
