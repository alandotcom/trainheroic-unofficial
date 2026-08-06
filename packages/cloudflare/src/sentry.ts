import * as Sentry from "@sentry/cloudflare";
import type { CloudflareOptions } from "@sentry/cloudflare";

/**
 * Shared Sentry configuration for the Worker fetch handler (wrapped with `withSentry` in
 * `index.ts`).
 *
 * The DSN is a secret, never a committed var: `wrangler secret put SENTRY_DSN` in production,
 * `.dev.vars` locally. With no DSN the SDK initializes disabled and every Sentry call becomes
 * a no-op, so local dev and the test suite run untouched.
 *
 * Privacy invariant — we keep the error and the signed-in user's email, nothing else:
 *   - `sendDefaultPii: false` keeps IP addresses, cookies, and auth headers off the events.
 *   - `httpServerIntegration({ maxRequestBodySize: "none" })` disables request-body capture, so
 *     the login POST (which carries the TrainHeroic password) can never reach Sentry.
 *   - Tracing is on (`tracesSampleRate`), so each request emits a span and every tool call runs
 *     inside its own `mcp.tool/<name>` span (tool-metrics.ts). Without MCP protocol sessions,
 *     traces correlate on `mcp.session` = `user:<thUserId>` (opaque numeric id, not email).
 *   - The email is attached explicitly via `Sentry.setUser` in the MCP factory, and `beforeSend`
 *     clamps `event.user` down to just the email so nothing else (id, username, geo) leaks.
 *   - Aggregate metrics carry only low-cardinality tags (`role`, tool name, ok/error), never the
 *     email or any other PII.
 */
function tracesSampleRate(env: Env): number {
  const parsed = Number(env.SENTRY_TRACES_SAMPLE_RATE);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 1;
}
export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN,
    release: env.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: tracesSampleRate(env),
    integrations: [Sentry.httpServerIntegration({ maxRequestBodySize: "none" })],
    beforeSend(event) {
      if (event.user) {
        if (event.user.email) event.user = { email: event.user.email };
        else delete event.user;
      }
      return event;
    },
  };
}

/** Opaque correlation key for a signed-in user (`user:<thUserId>`). */
export function mcpUserKey(thUserId: number): string {
  return `user:${thUserId}`;
}

/**
 * Stamp the current execution context with a correlation key so one user's traces and error
 * events share a queryable `mcp.session` tag. Value is never PII (numeric user id or a
 * legacy-session marker).
 */
export function tagMcpUser(key: string): void {
  Sentry.setTag("mcp.session", key);
  Sentry.getActiveSpan()?.setAttribute("mcp.session", key);
}
