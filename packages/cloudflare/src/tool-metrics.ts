import * as Sentry from "@sentry/cloudflare";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tagMcpSession } from "./sentry";

/** Which tool set a tool belongs to. A coach session also registers the athlete surface. */
export type ToolSurface = "athlete" | "coach";

/**
 * A mutable handle returned by {@link instrumentToolMetrics}. Set `.surface` to the surface
 * currently registering, before each `registerXxxSurface` call; every tool registered while it
 * holds that value is tagged with it. Each tool belongs to exactly one surface, so this adds a
 * queryable dimension at zero extra metric cardinality.
 */
export interface ToolInstrumentation {
  surface: ToolSurface;
}

/**
 * Wrap every tool registered on `server` with two kinds of telemetry:
 *   - Aggregate metrics: `mcp.tool.call` (counter, tagged by `tool`, `surface`, `status`) and
 *     `mcp.tool.duration_ms` (distribution, tagged by `tool`, `surface`).
 *   - Per-call tracing: each call runs inside its own `mcp.tool/<name>` span (op `mcp.tool`), so
 *     it shows up as a named, timed row in the trace waterfall rather than as bare attributes on
 *     the request span. The span carries the tool name, surface, opaque `sessionId`, and an
 *     ok/error `mcp.status`; an errored call (thrown or in-band `{ isError: true }`) is marked
 *     with Sentry's error status so it shows red. The enclosing DO request span and the
 *     per-message isolation scope are also tagged with `mcp.session`, so every trace and error
 *     event from one MCP session shares a key the trace explorer can filter on (a single MCP
 *     session spans many requests/traces — one tied-together waterfall is not possible, so a
 *     shared `mcp.session` dimension is how they are correlated; see agent.ts and index.ts for
 *     the matching tags on the DO init/error scopes and the worker-level request span).
 *     Aggregation stays the metrics' job; per-session drill-down stays the trace's job.
 *
 * The returned handle's `surface` is read at registration time (synchronously, while a surface's
 * tools register), so the caller flips it around each registration block — see agent.ts.
 *
 * Privacy: the only attributes are the tool name, surface, an ok/error status, and the session id
 * — never the tool arguments or result payloads, which can carry athlete PII. This keeps the
 * Sentry privacy invariant intact (see sentry.ts). No-op when SENTRY_DSN is unset (`startSpan`,
 * `setTag`, and the metrics calls all become no-ops), and the metrics and spans flush on
 * `ctx.waitUntil` via the DO's Sentry instrumentation, like the auth flow.
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
export function instrumentToolMetrics(server: McpServer, sessionId: string): ToolInstrumentation {
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
        sessionId,
        handler as (...handlerArgs: unknown[]) => unknown,
      );
    }
    return original(...args);
  };
  (server as unknown as { registerTool: unknown }).registerTool = patched;
  return state;
}

function isErrorResult(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { isError?: unknown }).isError === true
  );
}

/**
 * Sentry's error span-status code (the OTEL `SpanStatusCode.ERROR`). Inlined rather than imported
 * from `@sentry/core` to keep the dependency surface to the single `@sentry/cloudflare` meta-package
 * (`@sentry/core` is only a transitive dependency here).
 */
const SPAN_STATUS_ERROR = 2;

function wrapHandler(
  name: string,
  surface: ToolSurface,
  sessionId: string,
  handler: (...handlerArgs: unknown[]) => unknown,
): (...handlerArgs: unknown[]) => unknown {
  return (...handlerArgs: unknown[]): unknown => {
    // Tag the enclosing DO request span and this per-message isolation scope with the session, so
    // the transaction and any error captured during the call carry the same `mcp.session` key the
    // tool span below does (each per-message invocation gets a fresh scope; see tagMcpSession).
    tagMcpSession(sessionId);

    const start = Date.now();
    const recordMetrics = (status: "ok" | "error"): void => {
      Sentry.metrics.count("mcp.tool.call", 1, { attributes: { tool: name, surface, status } });
      Sentry.metrics.distribution("mcp.tool.duration_ms", Date.now() - start, {
        unit: "millisecond",
        attributes: { tool: name, surface },
      });
    };

    // Run the call inside its own span so it is a named, timed row in the trace waterfall. Sentry
    // ends the span when this callback returns — or, for an async handler, when the returned
    // promise settles — so the span duration tracks the tool's wall-clock (bounded by the same
    // I/O-advance limit as the metric duration above).
    return Sentry.startSpan(
      {
        name: `mcp.tool/${name}`,
        op: "mcp.tool",
        attributes: { "mcp.tool": name, "mcp.surface": surface, "mcp.session": sessionId },
      },
      (span): unknown => {
        const settle = (status: "ok" | "error"): void => {
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
