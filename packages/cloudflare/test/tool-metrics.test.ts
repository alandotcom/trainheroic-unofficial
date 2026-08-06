import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { instrumentToolMetrics } from "../src/tool-metrics";

type Handler = (args: unknown, extra: unknown) => unknown;

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

describe("instrumentToolMetrics", () => {
  it("wraps registered tools without throwing on ok results", () => {
    const { server, handlers } = recordingServer();
    const inst = instrumentToolMetrics(server, "user:1");
    inst.surface = "athlete";
    server.registerTool("foo", {}, () => okResult());
    expect(handlers.get("foo")?.({}, {})).toEqual(okResult());
  });

  it("rethrows from a throwing handler", () => {
    const { server, handlers } = recordingServer();
    const inst = instrumentToolMetrics(server, "user:2");
    inst.surface = "system";
    server.registerTool("boom", {}, () => {
      throw new Error("nope");
    });
    expect(() => handlers.get("boom")?.({}, {})).toThrow("nope");
  });

  it("accepts in-band error results", () => {
    const { server, handlers } = recordingServer();
    const inst = instrumentToolMetrics(server, "user:3");
    inst.surface = "coach";
    server.registerTool("bar", {}, () => errResult());
    expect(handlers.get("bar")?.({}, {})).toEqual(errResult());
  });
});
