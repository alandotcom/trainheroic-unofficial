import * as Sentry from "@sentry/cloudflare";
import type { CloudflareOptions } from "@sentry/cloudflare";

/**
 * Shared Sentry configuration for both entry points: the Worker fetch handler (wrapped with
 * `withSentry` in `index.ts`) and the Durable Object (wrapped with
 * `instrumentDurableObjectWithSentry`). Both take an `(env) => options` callback, so they
 * share this one.
 *
 * The DSN is a secret, never a committed var: `wrangler secret put SENTRY_DSN` in production,
 * `.dev.vars` locally. With no DSN the SDK initializes disabled and every Sentry call becomes
 * a no-op, so local dev and the test suite run untouched.
 *
 * Privacy invariant — we keep the error and the signed-in user's email, nothing else:
 *   - `sendDefaultPii: false` keeps IP addresses, cookies, and auth headers off the events.
 *   - `httpServerIntegration({ maxRequestBodySize: "none" })` disables request-body capture, so
 *     the login POST (which carries the TrainHeroic password) can never reach Sentry. This is
 *     the v10 lever; the newer `dataCollection.httpBodies` docs do not apply to this version.
 *   - Tracing is on (`tracesSampleRate`), so each request emits a span and every tool call runs
 *     inside its own `mcp.tool/<name>` span (tool-metrics.ts), which is what gives a per-session
 *     timing waterfall. A session spans many requests, so they cannot share one trace; instead the
 *     opaque mcp-session-id is set as the `mcp.session` tag on the worker request span (index.ts),
 *     the DO init/error scopes (agent.ts), and each tool-call invocation (tool-metrics.ts), so a
 *     session's traces and error events correlate on one queryable key. It stays PII-safe:
 *     `sendDefaultPii: false` keeps IPs, cookies, and auth headers off the spans, request bodies
 *     are disabled (above, so the login password is never captured), and the only custom span
 *     attributes we add are the tool name, surface, an ok/error status, and the session id —
 *     never the email or tool arguments.
 *   - The email is attached explicitly via `Sentry.setUser` in the agent, and `beforeSend`
 *     clamps `event.user` down to just the email so nothing else (id, username, geo) leaks.
 *   - Aggregate metrics (`Sentry.metrics.*`, emitted from the auth flow and around every tool
 *     call) are a separate channel from error events and spans; their attributes carry only
 *     low-cardinality tags (`role`, tool name, ok/error), never the email or any other PII. Keep
 *     it that way — per-session slicing is the trace's job, not the metrics'.
 */
// Trace every request by default (volume is small at current scale and per-session waterfalls
// need the spans). Driven by the `SENTRY_TRACES_SAMPLE_RATE` var so it can be dialed from the
// Cloudflare dashboard without a code change; anything unset, non-numeric, or out of [0, 1]
// falls back to 1. Spans carry only non-PII data (see the privacy note above).
function tracesSampleRate(env: Env): number {
  const parsed = Number(env.SENTRY_TRACES_SAMPLE_RATE);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 1;
}
export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN,
    // Set by the deploy script so events line up with the uploaded source maps.
    release: env.SENTRY_RELEASE,
    sendDefaultPii: false,
    // Tracing on so tool calls can be inspected per session; see the privacy note above.
    tracesSampleRate: tracesSampleRate(env),
    // Overrides the default HttpServer integration (same name) to never read request bodies.
    integrations: [Sentry.httpServerIntegration({ maxRequestBodySize: "none" })],
    beforeSend(event) {
      // Belt-and-suspenders: the only user datum we send is the email. Drop anything else
      // the SDK may have inferred (ip_address, id, username, geo).
      if (event.user) {
        if (event.user.email) event.user = { email: event.user.email };
        else delete event.user;
      }
      return event;
    },
  };
}

/**
 * The `mcp.session` value for a streamable-HTTP MCP session, derived from the raw `mcp-session-id`
 * header. The Agents SDK names each session's Durable Object `streamable-http:<id>` (exposed as
 * `this.name` in agent.ts), so the worker layer — which only sees the header, not the DO — mirrors
 * that prefix here. This is the single place that owns the key's shape: if the SDK naming ever
 * changes, update it here so worker spans keep correlating with DO spans under one value.
 */
export function mcpSessionKey(id: string): string {
  return `streamable-http:${id}`;
}

/**
 * Stamp the current execution context with the session, so one MCP session's traces and error
 * events correlate on a shared `mcp.session` key. Sets a scope tag (carried by error events) and an
 * attribute on the active span (carried by the enclosing transaction). Every entry point calls this
 * — the worker request (index.ts), the DO init/error scopes (agent.ts), and each tool-call
 * invocation (tool-metrics.ts) — because each per-message DO invocation gets a fresh isolation
 * scope that init()'s tag does not reach. No-op when SENTRY_DSN is unset; the value is the opaque
 * session id, never PII (see the privacy note above).
 */
export function tagMcpSession(key: string): void {
  Sentry.setTag("mcp.session", key);
  Sentry.getActiveSpan()?.setAttribute("mcp.session", key);
}
