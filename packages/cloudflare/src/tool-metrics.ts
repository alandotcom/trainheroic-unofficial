import * as Sentry from "@sentry/cloudflare";
import type { McpServer } from "@modelcontextprotocol/server";
import { isInputRequiredResult } from "@modelcontextprotocol/server";
import { tagMcpUser } from "./sentry";

/**
 * Which tool set a tool belongs to. A coach session also registers the athlete surface; `system`
 * covers the cross-cutting tools that belong to neither role (the feedback reporter).
 */
export type ToolSurface = "athlete" | "coach" | "system";

/**
 * A mutable handle returned by {@link instrumentToolMetrics}. Set `.surface` before each
 * registration block; every tool registered while it holds that value is tagged with it.
 */
export interface ToolInstrumentation {
  surface: ToolSurface;
}

/**
 * Wrap every tool registered on `server` with aggregate Sentry metrics and per-call spans.
 * Correlation uses `user:<thUserId>` (see sentry.ts). Lives here so `core` stays Sentry-agnostic.
 *
 * Recent-call history for feedback is intentionally not retained: protocol sessions are gone,
 * and Sentry tool spans already carry the same non-PII tags for a user's activity.
 */
export function instrumentToolMetrics(
  server: McpServer,
  correlationId: string,
): ToolInstrumentation {
  const state: ToolInstrumentation = { surface: "athlete" };
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
