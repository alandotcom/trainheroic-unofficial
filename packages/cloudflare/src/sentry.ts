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
 *   - `tracesSampleRate: 0` keeps it errors-only; no performance spans are sent.
 *   - The email is attached explicitly via `Sentry.setUser` in the agent, and `beforeSend`
 *     clamps `event.user` down to just the email so nothing else (id, username, geo) leaks.
 *   - Aggregate metrics (`Sentry.metrics.*`, emitted from the auth flow) are a separate channel
 *     from error events; their attributes carry only low-cardinality tags like `role`, never the
 *     email or any other PII. Keep it that way.
 */
export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN,
    // Set by the deploy script so events line up with the uploaded source maps.
    release: env.SENTRY_RELEASE,
    sendDefaultPii: false,
    // Errors only — no performance tracing, no extra request data.
    tracesSampleRate: 0,
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
