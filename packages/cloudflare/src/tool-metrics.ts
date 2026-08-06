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
 * Handle returned by {@link instrumentToolMetrics}. Use {@link ToolInstrumentation.run} around
 * each registration block so tools pick up the right surface tag.
 */
export interface ToolInstrumentation {
  run(surface: ToolSurface, fn: () => void): void;
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
  let surface: ToolSurface = "athlete";
  const original = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  const patched = (...args: unknown[]): unknown => {
    const name = typeof args[0] === "string" ? args[0] : "unknown";
    const taggedSurface = surface;
    const lastIndex = args.length - 1;
    const handler = args[lastIndex];
    if (typeof handler === "function") {
      args[lastIndex] = wrapHandler(
        name,
        taggedSurface,
        correlationId,
        handler as (...handlerArgs: unknown[]) => unknown,
      );
    }
    return original(...args);
  };
  (server as unknown as { registerTool: unknown }).registerTool = patched;
  return {
    run(next: ToolSurface, fn: () => void): void {
      const prev = surface;
      surface = next;
      try {
        fn();
      } finally {
        surface = prev;
      }
    },
  };
}

/** How a settled tool invocation is classified for metrics and span status. */
export type ToolOutcome = "ok" | "error" | "input_required";

/**
 * Classify what a tool handler returned.
 *
 * `input_required` is its own outcome, not a success: every gated tool now returns an MRTR
 * elicitation round on its first invocation and does the work on the client's retry, so counting
 * that round as a completed call would double every destructive tool's `mcp.tool.call` count and
 * pollute the duration distribution with near-zero samples. An error is either a thrown handler
 * or the in-band `{ isError: true }` convention the model self-corrects on.
 */
export function toolOutcome(result: unknown): ToolOutcome {
  if (isInputRequiredResult(result)) return "input_required";
  const isError =
    typeof result === "object" &&
    result !== null &&
    (result as { isError?: unknown }).isError === true;
  return isError ? "error" : "ok";
}

/**
 * Sentry's error span-status code (the OTEL `SpanStatusCode.ERROR`). Inlined rather than imported
 * from `@sentry/core` to keep the dependency surface to the single `@sentry/cloudflare`
 * meta-package (`@sentry/core` is only a transitive dependency here).
 */
const SPAN_STATUS_ERROR = 2;

function wrapHandler(
  name: string,
  surface: ToolSurface,
  correlationId: string,
  handler: (...handlerArgs: unknown[]) => unknown,
): (...handlerArgs: unknown[]) => unknown {
  return (...handlerArgs: unknown[]): unknown => {
    tagMcpUser(correlationId);

    // Durations are approximate: Workers advances `Date.now()` only across I/O, which every
    // TrainHeroic-backed tool performs, so the wall-clock spent waiting on the API is captured.
    const start = Date.now();
    const recordMetrics = (status: ToolOutcome): void => {
      // An elicitation round has not run the tool, so it belongs in neither the call count nor
      // the duration distribution. Its span still records the outcome (below).
      if (status === "input_required") return;
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
        const settle = (status: ToolOutcome): void => {
          recordMetrics(status);
          span.setAttribute("mcp.status", status);
          // A thrown/rejected handler already trips Sentry's error status; mark the in-band
          // `{ isError: true }` convention too so both failure modes show red in the waterfall.
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
              settle(toolOutcome(resolved));
              return resolved;
            },
            (err: unknown) => {
              settle("error");
              throw err;
            },
          );
        }

        settle(toolOutcome(result));
        return result;
      },
    );
  };
}
