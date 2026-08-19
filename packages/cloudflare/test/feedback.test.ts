import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";

const sentry = vi.hoisted(() => ({
  isEnabled: vi.fn(() => true),
  captureFeedback: vi.fn((..._args: unknown[]): string => "evt_abc123"),
}));

vi.mock("@sentry/cloudflare", () => {
  const scope = { setTags: vi.fn(), setContext: vi.fn() };
  return {
    isEnabled: () => sentry.isEnabled(),
    captureFeedback: (...args: unknown[]) => sentry.captureFeedback(...args),
    withScope: (fn: (s: typeof scope) => unknown) => fn(scope),
  };
});

import { registerFeedbackTool } from "../src/tools/feedback";

type Handler = (args: Record<string, unknown>, extra: unknown) => CallToolResult;

function captureServer(): {
  server: McpServer;
  registered: { name: string; config: { annotations?: Record<string, unknown> }; handler: Handler };
} {
  const registered = {} as ReturnType<typeof captureServer>["registered"];
  const server = {
    registerTool: (name: string, config: unknown, handler: Handler) => {
      registered.name = name;
      registered.config = config as { annotations?: Record<string, unknown> };
      registered.handler = handler;
      return {};
    },
  } as unknown as McpServer;
  return { server, registered };
}

function deps() {
  return {
    email: "user@example.com",
    role: "coach" as const,
    correlationId: "user:42",
    version: "9.9.9",
    release: "rel-1",
  };
}

function resultJson(result: CallToolResult): Record<string, unknown> {
  const first = result.content[0];
  if (!first || first.type !== "text") throw new Error("expected text content");
  return JSON.parse(first.text) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
  sentry.isEnabled.mockReset();
  sentry.captureFeedback.mockReset();
  sentry.isEnabled.mockReturnValue(true);
  sentry.captureFeedback.mockReturnValue("evt_abc123");
});

describe("report_feedback tool", () => {
  it("registers a single destructive external-submission tool", () => {
    const { server, registered } = captureServer();
    registerFeedbackTool(server, deps());
    expect(registered.name).toBe("report_feedback");
    expect(registered.config.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
  });

  it("sends a self-contained report through Sentry feedback when enabled", () => {
    const { server, registered } = captureServer();
    registerFeedbackTool(server, deps());

    const result = registered.handler(
      {
        message: "athlete_workouts returned nothing",
        kind: "bug",
        expected: "this week's sessions",
        actual: "an empty list",
      },
      {},
    );

    expect(sentry.captureFeedback).toHaveBeenCalledTimes(1);
    const params = sentry.captureFeedback.mock.calls[0]?.[0] as {
      message: string;
      email: string;
      source: string;
      tags: Record<string, unknown>;
    };
    expect(params.email).toBe("user@example.com");
    expect(params.source).toBe("report_feedback");
    expect(params.tags).toMatchObject({
      "feedback.kind": "bug",
      "mcp.role": "coach",
      "mcp.session": "user:42",
    });
    expect(params.message).toContain("athlete_workouts returned nothing");
    expect(params.message).toContain("Expected: this week's sessions");
    expect(params.message).toContain("Actual: an empty list");
    expect(params.message).toContain("correlation: user:42");
    expect(params.message).toContain("release: rel-1");
    expect(params.message).not.toContain("recent tool calls");

    const json = resultJson(result);
    expect(json).toMatchObject({ status: "sent", reference: "evt_abc123" });
  });

  it("falls back to a structured log when Sentry is not configured", () => {
    sentry.isEnabled.mockReturnValue(false);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { server, registered } = captureServer();
    registerFeedbackTool(server, deps());

    const result = registered.handler({ message: "swap is confusing", kind: "idea" }, {});

    expect(sentry.captureFeedback).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    const [tag, payload] = log.mock.calls[0] as [string, string];
    expect(tag).toBe("[feedback]");
    expect(payload).toContain("swap is confusing");
    expect(payload).toContain("user@example.com");

    expect(resultJson(result)).toMatchObject({ status: "logged" });
  });
});
