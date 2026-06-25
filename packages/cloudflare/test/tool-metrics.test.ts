import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { instrumentToolMetrics } from "../src/tool-metrics";

type Handler = (args: unknown, extra: unknown) => unknown;

/**
 * A server whose `registerTool` stores the handler the instrumentation hands it — i.e. the wrapped
 * handler — so a test can invoke it and observe the side effects of the wrapper (the ring buffer).
 * Sentry is left uninitialized here, so its spans/metrics are no-ops; only the buffer is exercised.
 */
function recordingServer(): { server: McpServer; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      handlers.set(name, handler);
      return {};
    },
  } as unknown as McpServer;
  return { server, handlers };
}

const okResult = (): CallToolResult => ({ content: [{ type: "text", text: "ok" }] });
const errResult = (): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: "bad" }],
});

describe("instrumentToolMetrics recent-call buffer", () => {
  it("records a completed call with its registration-time surface", () => {
    const { server, handlers } = recordingServer();
    const inst = instrumentToolMetrics(server, "sess-1");
    inst.surface = "athlete";
    server.registerTool("foo", {}, () => okResult());

    handlers.get("foo")?.({}, {});

    expect(inst.recentCalls).toEqual([
      { tool: "foo", surface: "athlete", status: "ok", ms: expect.any(Number) },
    ]);
  });

  it("marks an in-band { isError: true } result as an error", () => {
    const { server, handlers } = recordingServer();
    const inst = instrumentToolMetrics(server, "sess-2");
    inst.surface = "coach";
    server.registerTool("bar", {}, () => errResult());

    handlers.get("bar")?.({}, {});

    expect(inst.recentCalls.at(-1)).toMatchObject({
      tool: "bar",
      surface: "coach",
      status: "error",
    });
  });

  it("records a thrown handler as an error and still rethrows", () => {
    const { server, handlers } = recordingServer();
    const inst = instrumentToolMetrics(server, "sess-3");
    inst.surface = "system";
    server.registerTool("boom", {}, () => {
      throw new Error("nope");
    });

    expect(() => handlers.get("boom")?.({}, {})).toThrow("nope");
    expect(inst.recentCalls.at(-1)).toMatchObject({
      tool: "boom",
      surface: "system",
      status: "error",
    });
  });

  it("caps the buffer, dropping the oldest entries", () => {
    const { server, handlers } = recordingServer();
    const inst = instrumentToolMetrics(server, "sess-4");
    inst.surface = "athlete";
    server.registerTool("t", {}, () => okResult());
    const handler = handlers.get("t");

    for (let i = 0; i < 25; i++) handler?.({}, {});

    // MAX_RECENT_CALLS is 20; the buffer keeps the most recent 20, oldest first.
    expect(inst.recentCalls).toHaveLength(20);
    expect(inst.recentCalls.every((c) => c.tool === "t")).toBe(true);
  });
});
