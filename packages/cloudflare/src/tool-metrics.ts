import * as Sentry from "@sentry/cloudflare";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Wrap every tool registered on `server` with two kinds of telemetry:
 *   - Aggregate metrics: `mcp.tool.call` (counter, tagged by `tool` + `status`) and
 *     `mcp.tool.duration_ms` (distribution, tagged by `tool`).
 *   - Per-session tracing: the active request span (created by the DO's Sentry instrumentation)
 *     is annotated with the tool name and the opaque `sessionId`, so Sentry's trace view can be
 *     filtered to a single session's tool calls. Aggregation stays the metrics' job; per-session
 *     drill-down stays the trace's job.
 *
 * Privacy: the only attributes are the tool name, an ok/error status, and the session id — never
 * the tool arguments or result payloads, which can carry athlete PII. This keeps the Sentry
 * privacy invariant intact (see sentry.ts). No-op when SENTRY_DSN is unset, and the metrics and
 * spans flush on `ctx.waitUntil` via the Durable Object's Sentry instrumentation, like the auth flow.
 *
 * This lives here, not in `core`, so the shared tool layer stays transport- and Sentry-agnostic
 * (the local stdio servers reuse it without pulling in `@sentry/cloudflare`). Patching the single
 * `registerTool` seam covers every surface — coach, athlete, and the D1 sync tools — at once.
 *
 * A tool error is counted when the handler throws OR returns an in-band `{ isError: true }`
 * result (the `attempt`/`errorResult` convention the model self-corrects on). Durations are
 * approximate: Workers advances `Date.now()` only across I/O, which every TrainHeroic-backed
 * tool performs, so the wall-clock spent waiting on the API is captured.
 */
export function instrumentToolMetrics(server: McpServer, sessionId: string): void {
  const original = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  const patched = (...args: unknown[]): unknown => {
    const name = typeof args[0] === "string" ? args[0] : "unknown";
    const lastIndex = args.length - 1;
    const handler = args[lastIndex];
    if (typeof handler === "function") {
      args[lastIndex] = wrapHandler(
        name,
        sessionId,
        handler as (...handlerArgs: unknown[]) => unknown,
      );
    }
    return original(...args);
  };
  (server as unknown as { registerTool: unknown }).registerTool = patched;
}

function isErrorResult(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { isError?: unknown }).isError === true
  );
}

function wrapHandler(
  name: string,
  sessionId: string,
  handler: (...handlerArgs: unknown[]) => unknown,
): (...handlerArgs: unknown[]) => unknown {
  return (...handlerArgs: unknown[]): unknown => {
    // Annotate the active request span (from the DO's Sentry instrumentation) so the trace view
    // can be sliced to one session's tool calls. Null-safe when tracing is off / no active span.
    Sentry.getActiveSpan()?.setAttributes({ "mcp.tool": name, "mcp.session": sessionId });

    const start = Date.now();
    const finish = (status: "ok" | "error"): void => {
      Sentry.metrics.count("mcp.tool.call", 1, { attributes: { tool: name, status } });
      Sentry.metrics.distribution("mcp.tool.duration_ms", Date.now() - start, {
        unit: "millisecond",
        attributes: { tool: name },
      });
    };

    let result: unknown;
    try {
      result = handler(...handlerArgs);
    } catch (err) {
      finish("error");
      throw err;
    }

    if (result instanceof Promise) {
      return result.then(
        (resolved: unknown) => {
          finish(isErrorResult(resolved) ? "error" : "ok");
          return resolved;
        },
        (err: unknown) => {
          finish("error");
          throw err;
        },
      );
    }

    finish(isErrorResult(result) ? "error" : "ok");
    return result;
  };
}
