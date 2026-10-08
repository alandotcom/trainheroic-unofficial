import * as Sentry from "@sentry/cloudflare";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { authHandler } from "./auth/handler";
import { athleteMcpHandler, coachMcpHandler, fullMcpHandler } from "./mcp";
import { oauthProviderErrorReporter, sentryOptions } from "./sentry";

export { TrainHeroicUpstream } from "./upstream-coordinator";

// OAUTH_KV key holding where the scheduled purge sweep resumes. It has no `grant:`, `token:` or
// `client:` prefix, so the provider never reads or deletes it.
const PURGE_CURSOR_KEY = "purge-cursor";

// The provider binds every grant and access token to one canonical resource, and 1.x compares
// that audience exactly. The Worker answers on several origins (the custom domain, workers.dev,
// and localhost under `wrangler dev`), so the provider is built per request with the resource
// set to that origin's `/mcp`. `/mcp/coach` and `/mcp/athlete` sit under `/mcp`, so one token
// works on all three mount paths, and the 401 challenge on any of them points clients at the
// `/.well-known/oauth-protected-resource/mcp` document.
function oauthProvider(origin: string): OAuthProvider {
  return new OAuthProvider({
    // Most specific routes first: `apiHandlers` is matched by prefix in insertion order, so
    // `/mcp/coach` and `/mcp/athlete` must precede `/mcp` or they'd be swallowed by it.
    apiHandlers: {
      "/mcp/coach": coachMcpHandler,
      "/mcp/athlete": athleteMcpHandler,
      "/mcp": fullMcpHandler,
    },
    defaultHandler: authHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    // DCR remains for the deprecation window (MCP 2026-07-28; removal after summer 2027).
    // Prefer CIMD for new clients.
    clientRegistrationEndpoint: "/register",
    // Requires the `global_fetch_strictly_public` compatibility flag in wrangler.jsonc — the
    // provider advertises CIMD as unsupported without it, and `getClient` then throws (a 500)
    // on any URL-shaped client_id instead of answering a clean `invalid_client`. The two move
    // together; do not enable one without the other.
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: { resource: `${origin}/mcp` },
    // Published as the resource metadata's `scopes_supported` and named in the 401 challenge.
    requiredScopes: ["mcp"],
    scopesSupported: ["mcp"],
    // OAuth wire errors remain generic; report only the provider's tagged internal diagnosis.
    // The reporter deliberately omits the Request and diagnostic detail to keep URLs and secrets
    // out of Sentry.
    onError: oauthProviderErrorReporter,
  });
}

// Credential-attempt surface: a tight per-IP budget guards brute force and registration
// spam. The looser MCP_RATE_LIMITER covers /mcp and everything else.
export function isLoginAttempt(request: Request, pathname: string): boolean {
  if (pathname === "/token" || pathname === "/register") return true;
  return pathname === "/authorize" && request.method === "POST";
}

// Best-effort, per-colo edge rate limiting before any auth or MCP work. Keyed by
// the only trustworthy client IP behind Cloudflare (CF-Connecting-IP; never X-Forwarded-For).
async function isRateLimited(request: Request, env: Env): Promise<boolean> {
  const pathname = new URL(request.url).pathname;
  const limiter = isLoginAttempt(request, pathname) ? env.LOGIN_RATE_LIMITER : env.MCP_RATE_LIMITER;
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await limiter.limit({ key: `ip:${ip}` });
  return !success;
}

function tooManyRequests(): Response {
  return new Response(
    JSON.stringify({ error: "rate_limited", message: "Too many requests. Try again shortly." }),
    { status: 429, headers: { "content-type": "application/json", "retry-after": "60" } },
  );
}

const handler = {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    if (await isRateLimited(request, env)) return tooManyRequests();
    return oauthProvider(new URL(request.url).origin).fetch(request, env, ctx);
  },
  // KV hygiene: drop expired/orphaned grants, tokens, and client registrations. Each run checks
  // at most `batchSize` grants and tokens, then stores a cursor in OAUTH_KV so the next daily run
  // resumes the sweep where this one stopped; a finished sweep deletes the cursor so the next run
  // starts over. Log the result so the unattended job is observable, and rethrow on failure so a
  // stuck purge shows as a failed cron invocation rather than silent, unbounded KV growth.
  scheduled: async (_controller: ScheduledController, env: Env): Promise<void> => {
    try {
      const cursor = (await env.OAUTH_KV.get(PURGE_CURSOR_KEY)) ?? undefined;
      // A cron run has no request origin. The purge walks KV records without checking their
      // audience, so the localhost resource serves for every deployment.
      const result = await oauthProvider("http://localhost").purgeExpiredData(env, {
        batchSize: 100,
        ...(cursor ? { cursor } : {}),
      });
      if (result.cursor) await env.OAUTH_KV.put(PURGE_CURSOR_KEY, result.cursor);
      else await env.OAUTH_KV.delete(PURGE_CURSOR_KEY);
      console.log("oauth purge complete", result);
    } catch (err) {
      console.error("oauth purge failed", err);
      throw err;
    }
  },
} satisfies ExportedHandler<Env>;

// Reports errors from the top-level fetch and scheduled handlers (rate limiting, the OAuth flow,
// the cron purge). Errors raised inside an MCP request never reach here — createMcpHandler
// catches and converts them — so those are reported by the `onerror` hook in mcp.ts instead.
export default Sentry.withSentry(sentryOptions, handler);
