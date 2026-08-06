import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { inputRequired } from "@modelcontextprotocol/server";
import { instrumentToolMetrics, toolOutcome } from "../src/tool-metrics";

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
/** What `confirmGate` returns on the first call of any gated tool. */
const elicitation = () =>
  inputRequired({
    inputRequests: {
      confirm: inputRequired.elicit({
        message: "Confirm?",
        requestedSchema: {
          type: "object",
          properties: { confirm: { type: "boolean" } },
          required: ["confirm"],
        },
      }),
    },
  });

describe("instrumentToolMetrics", () => {
  it("wraps registered tools without throwing on ok results", () => {
    const { server, handlers } = recordingServer();
    const metrics = instrumentToolMetrics(server, "user:1");
    metrics.run("athlete", () => {
      server.registerTool("foo", {}, () => okResult());
    });
    expect(handlers.get("foo")?.({}, {})).toEqual(okResult());
  });

  it("rethrows from a throwing handler", () => {
    const { server, handlers } = recordingServer();
    const metrics = instrumentToolMetrics(server, "user:2");
    metrics.run("system", () => {
      server.registerTool("boom", {}, () => {
        throw new Error("nope");
      });
    });
    expect(() => handlers.get("boom")?.({}, {})).toThrow("nope");
  });

  it("accepts in-band error results", () => {
    const { server, handlers } = recordingServer();
    const metrics = instrumentToolMetrics(server, "user:3");
    metrics.run("coach", () => {
      server.registerTool("bar", {}, () => errResult());
    });
    expect(handlers.get("bar")?.({}, {})).toEqual(errResult());
  });

  it("passes an MRTR elicitation round through unchanged", () => {
    const { server, handlers } = recordingServer();
    const metrics = instrumentToolMetrics(server, "user:4");
    metrics.run("coach", () => {
      server.registerTool("gated", {}, () => elicitation());
    });
    expect(toolOutcome(handlers.get("gated")?.({}, {}))).toBe("input_required");
  });
});

describe("toolOutcome", () => {
  it("classifies a plain result as ok", () => {
    expect(toolOutcome(okResult())).toBe("ok");
  });

  it("classifies the in-band isError convention as an error", () => {
    expect(toolOutcome(errResult())).toBe("error");
  });

  it("classifies an elicitation round as neither", () => {
    // Every gated tool returns this on its first call and does the work on the client's retry.
    // Counting it as a completed call would double each destructive tool's call metric.
    expect(toolOutcome(elicitation())).toBe("input_required");
  });
});
