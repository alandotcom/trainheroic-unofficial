import * as Sentry from "@sentry/cloudflare";
import type { McpServer } from "@modelcontextprotocol/server";
import { isInputRequiredResult } from "@modelcontextprotocol/server";
import { tagMcpUser } from "./sentry";

/**
 * Which tool set a tool belongs to. A coach session also registers the athlete surface; `system`
 * covers the cross-cutting tools that belong to neither role (the feedback reporter).
 */
export type ToolSurface = "athlete" | "coach" | "system";

/** One entry in the recent-calls ring buffer: what ran, on which surface, and how it ended. */
export interface RecentToolCall {
  tool: string;
  surface: ToolSurface;
  status: "ok" | "error";
  ms: number;
}

/** How many recent tool calls to retain per user for bug-report context. */
const MAX_RECENT_CALLS = 20;

/**
 * Isolate-local recent-call buffers keyed by TrainHeroic user id. Protocol sessions are gone on
 * the createMcpHandler path, so this is best-effort within a warm isolate (not durable across
 * isolate recycles). Holds only non-PII fields — never arguments or results.
 */
const recentByUser = new Map<number, RecentToolCall[]>();

/** Snapshot of recent tool calls for a user (oldest first), for `report_feedback`. */
export function recentCallsForUser(thUserId: number): readonly RecentToolCall[] {
  return recentByUser.get(thUserId) ?? [];
}

/**
 * A mutable handle returned by {@link instrumentToolMetrics}. Set `.surface` to the surface
 * currently registering, before each `registerXxxSurface` call; every tool registered while it
 * holds that value is tagged with it.
 */
export interface ToolInstrumentation {
  surface: ToolSurface;
}

/**
 * Wrap every tool registered on `server` with aggregate Sentry metrics and per-call spans.
 * Correlation uses `user:<thUserId>` (see sentry.ts). Lives here so `core` stays Sentry-agnostic.
 */
export function instrumentToolMetrics(
  server: McpServer,
  correlationId: string,
  thUserId: number,
): ToolInstrumentation {
  const state: ToolInstrumentation = { surface: "athlete" };
  const record = (call: RecentToolCall): void => {
    const buf = recentByUser.get(thUserId) ?? [];
    buf.push(call);
    if (buf.length > MAX_RECENT_CALLS) buf.shift();
    recentByUser.set(thUserId, buf);
  };
  const original = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  const patched = (...args: unknown[]): unknown => {
    const name = typeof args[0] === "string" ? args[0] : "unknown";
    const surface = state.surface;
    const lastIndex = args.length - 1;
    const handler = args[lastIndex];
    if (typeof handler === "function") {
      args[lastIndex] = wrapHandler(
        name,
        surface,
        correlationId,
        record,
        handler as (...handlerArgs: unknown[]) => unknown,
      );
    }
    return original(...args);
  };
  (server as unknown as { registerTool: unknown }).registerTool = patched;
  return state;
}

function isErrorResult(result: unknown): boolean {
  if (isInputRequiredResult(result)) return false;
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { isError?: unknown }).isError === true
  );
}

const SPAN_STATUS_ERROR = 2;

function wrapHandler(
  name: string,
  surface: ToolSurface,
  correlationId: string,
  record: (call: RecentToolCall) => void,
  handler: (...handlerArgs: unknown[]) => unknown,
): (...handlerArgs: unknown[]) => unknown {
  return (...handlerArgs: unknown[]): unknown => {
    tagMcpUser(correlationId);

    const start = Date.now();
    const recordMetrics = (status: "ok" | "error"): void => {
      const ms = Date.now() - start;
      Sentry.metrics.count("mcp.tool.call", 1, { attributes: { tool: name, surface, status } });
      Sentry.metrics.distribution("mcp.tool.duration_ms", ms, {
        unit: "millisecond",
        attributes: { tool: name, surface },
      });
      record({ tool: name, surface, status, ms });
    };

    return Sentry.startSpan(
      {
        name: `mcp.tool/${name}`,
        op: "mcp.tool",
        attributes: { "mcp.tool": name, "mcp.surface": surface, "mcp.session": correlationId },
      },
      (span): unknown => {
        const settle = (status: "ok" | "error"): void => {
          recordMetrics(status);
          span.setAttribute("mcp.status", status);
          if (status === "error") {
            span.setStatus({ code: SPAN_STATUS_ERROR, message: "tool_error" });
          }
        };

        let result: unknown;
        try {
          result = handler(...handlerArgs);
        } catch (err) {
          settle("error");
          throw err;
        }

        if (result instanceof Promise) {
          return result.then(
            (resolved: unknown) => {
              settle(isErrorResult(resolved) ? "error" : "ok");
              return resolved;
            },
            (err: unknown) => {
              settle("error");
              throw err;
            },
          );
        }

        settle(isErrorResult(result) ? "error" : "ok");
        return result;
      },
    );
  };
}
