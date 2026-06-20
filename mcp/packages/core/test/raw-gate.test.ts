import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRawTools } from "../src/tools/raw";
import type { ToolContext } from "../src/context";

type Handler = (
  args: Record<string, unknown>,
  extra: { requestId?: string },
) => Promise<{
  isError?: boolean;
}>;

/** A fake McpServer that captures the registered tool handler and stubs elicitation. */
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

describe("th_request destructive gate is wired into the handler", () => {
  it("blocks a POST when elicitation is declined and never calls the API", async () => {
    let called = false;
    const { server, handlers } = harness(async () => ({ action: "decline" }));
    registerRawTools(
      server,
      ctx(() => {
        called = true;
      }),
    );
    const handler = handlers.get("th_request");
    expect(handler).toBeDefined();
    const res = await handler!({ method: "POST", path: "/x" }, { requestId: "r1" });
    expect(res.isError).toBe(true);
    expect(called).toBe(false);
  });

  it("does not gate a GET and lets it through", async () => {
    let called = false;
    let elicited = false;
    const { server, handlers } = harness(async () => {
      elicited = true;
      return { action: "accept", content: { confirm: true } };
    });
    registerRawTools(
      server,
      ctx(() => {
        called = true;
      }),
    );
    const res = await handlers.get("th_request")!(
      { method: "GET", path: "/x" },
      { requestId: "r1" },
    );
    expect(elicited).toBe(false);
    expect(called).toBe(true);
    expect(res.isError).toBeUndefined();
  });
});
