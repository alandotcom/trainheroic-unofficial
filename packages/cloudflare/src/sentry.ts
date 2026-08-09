import * as Sentry from "@sentry/cloudflare";
import type { CloudflareOptions } from "@sentry/cloudflare";
import type { OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import type { TrainHeroicHttpError, TrainHeroicHttpErrorHandler } from "@trainheroic-unofficial/js";

type OAuthProviderError = Parameters<NonNullable<OAuthProviderOptions["onError"]>>[0];
type OAuthInternalError = {
  code: string;
  status: number;
  category: string;
  reason: string;
};

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
 *     the login POST (which carries the TrainHeroic password) can never reach Sentry. Listing the
 *     integration overrides the default one of the same name rather than adding a second, which
 *     is what makes this effective. This is the v10 lever; the newer `dataCollection.httpBodies`
 *     docs do not apply to this version.
 *   - Tracing is on (`tracesSampleRate`), so each request emits a span and every tool call runs
 *     inside its own `mcp.tool/<name>` span (tool-metrics.ts). Without MCP protocol sessions,
 *     traces correlate on `mcp.session` = `user:<thUserId>` (opaque numeric id, not email).
 *   - The email is attached explicitly via `Sentry.setUser` in the MCP factory, and `beforeSend`
 *     clamps `event.user` down to just the email so nothing else (id, username, geo) leaks. Note
 *     `beforeSend` does NOT run on `type: "feedback"` events, so the `report_feedback` path
 *     (tools/feedback.ts) is guarded only by `sendDefaultPii: false` plus the rule that
 *     `setUser` only ever receives the email — keep it so.
 *   - Aggregate metrics carry only low-cardinality tags (`role`, tool name, ok/error), never the
 *     email or any other PII.
 */
// Driven by the `SENTRY_TRACES_SAMPLE_RATE` var so the rate can be dialed from the Cloudflare
// dashboard without a code change; anything unset, non-numeric, or out of [0, 1] falls back to 1.
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

/** Report an application-owned OAuth diagnostic without request URLs or upstream detail. */
export function reportOAuthInternalError(error: OAuthInternalError): void {
  Sentry.captureException(new Error("OAuth provider internal error"), {
    tags: {
      "oauth.error.code": error.code,
      "oauth.error.status": String(error.status),
      "oauth.internal.category": error.category,
      "oauth.internal.reason": error.reason,
    },
  });
}

/** Adapt the provider's diagnostic callback to the application's privacy-safe reporter. */
export function oauthProviderErrorReporter(error: OAuthProviderError): void {
  if (!error.internal) return;
  reportOAuthInternalError({
    code: error.code,
    status: error.status,
    category: error.internal.category,
    reason: error.internal.reason,
  });
}

/**
 * Stamp the current execution context with a correlation key so one user's traces and error
 * events share a queryable tag. Sets a scope tag (carried by error events) and an attribute on
 * the active span (carried by the enclosing transaction); every MCP entry point calls it,
 * because each request gets a fresh isolation scope. No-op when `SENTRY_DSN` is unset.
 *
 * The tag key stays `mcp.session` even though the value is now a user id, so Sentry queries and
 * saved views built before the SDK v2 migration keep working. The value is never PII.
 */
export function tagMcpUser(key: string): void {
  Sentry.setTag("mcp.session", key);
  Sentry.getActiveSpan()?.setAttribute("mcp.session", key);
}

/**
 * Report a final non-2xx TrainHeroic response as an error event. Fetch resolves normally for
 * HTTP failures, so neither `withSentry` nor the MCP handler's `onerror` sees these unless the
 * SDK surfaces them through its observability hook.
 */
function captureTrainHeroicHttpError(error: TrainHeroicHttpError): void {
  Sentry.captureException(error, {
    tags: {
      "upstream.service": "trainheroic",
      "http.request.method": error.method,
      "http.response.status_code": String(error.status),
      "server.address": error.host,
    },
  });
}

/** Bind every upstream error event to the TrainHeroic account that made the request. */
export function trainHeroicHttpErrorReporter(email: string): TrainHeroicHttpErrorHandler {
  return (error) => {
    Sentry.withScope((scope) => {
      scope.setUser({ email });
      captureTrainHeroicHttpError(error);
    });
  };
}

/** Invalid credentials are expected on the interactive login form; report every other failure. */
export function trainHeroicLoginErrorReporter(email: string): TrainHeroicHttpErrorHandler {
  const report = trainHeroicHttpErrorReporter(email);
  return (error) => {
    if (error.status === 401 || error.status === 403) return;
    return report(error);
  };
}
