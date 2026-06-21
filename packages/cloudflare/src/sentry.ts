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
 *   - Tracing is on (`tracesSampleRate`), so each request — including every tool call — emits a
 *     span, which is what gives a per-session timing waterfall (the spans are tagged with the
 *     opaque mcp-session-id in tool-metrics.ts). It stays PII-safe: `sendDefaultPii: false` keeps
 *     IPs, cookies, and auth headers off the spans, request bodies are disabled (above so the
 *     login password is never captured), and the only custom span attributes we add are the tool
 *     name and the session id — never the email or tool arguments.
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
