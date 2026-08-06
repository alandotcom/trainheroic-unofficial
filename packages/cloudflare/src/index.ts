import * as Sentry from "@sentry/cloudflare";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { authHandler } from "./auth/handler";
import { ATHLETE_SURFACES, COACH_SURFACES, FULL_SURFACES, mcpApiHandler } from "./mcp";
import { sentryOptions, tagMcpUser } from "./sentry";

const CANONICAL_MCP_RESOURCE = "https://mcp.trainheroic-unofficial.com/mcp";

const provider = new OAuthProvider({
  // Most specific routes first: `apiHandlers` is matched by prefix in insertion order, so
  // `/mcp/coach` and `/mcp/athlete` must precede `/mcp` or they'd be swallowed by it.
  //   /mcp         → full role-aware surface (production)
  //   /mcp/coach   → coaching tools only
  //   /mcp/athlete → athlete training tools only
  apiHandlers: {
    "/mcp/coach": mcpApiHandler("/mcp/coach", COACH_SURFACES),
    "/mcp/athlete": mcpApiHandler("/mcp/athlete", ATHLETE_SURFACES),
    "/mcp": mcpApiHandler("/mcp", FULL_SURFACES),
  },
  defaultHandler: authHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  // DCR remains for the deprecation window (MCP 2026-07-28; removal after summer 2027).
  // Prefer CIMD for new clients.
  clientRegistrationEndpoint: "/register",
  clientIdMetadataDocumentEnabled: true,
  resourceMetadata: {
    resource: CANONICAL_MCP_RESOURCE,
    scopes_supported: ["mcp"],
  },
  scopesSupported: ["mcp"],
  // Spec requires S256; the library defaults this to true for back-compat.
  allowPlainPKCE: false,
});

// Credential-attempt surface: a tight per-IP budget guards brute force and registration
// spam. The looser MCP_RATE_LIMITER covers /mcp and everything else.
export function isLoginAttempt(request: Request, pathname: string): boolean {
  if (pathname === "/token" || pathname === "/register") return true;
  return pathname === "/authorize" && request.method === "POST";
}

// Best-effort, per-colo edge rate limiting before any auth or Durable Object work. Keyed by
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
    // When a modern client still sends a legacy session header, tag for log correlation only;
    // protocol sessions are gone on the createMcpHandler path (ADR 0001).
    const sessionId = request.headers.get("mcp-session-id");
    if (sessionId) tagMcpUser(`legacy-session:${sessionId}`);
    return provider.fetch(request, env, ctx);
  },
  scheduled: async (_controller: ScheduledController, env: Env): Promise<void> => {
    // KV hygiene: drop expired/orphaned grants, tokens, and client registrations. Log the
    // result so the unattended job is observable, and rethrow on failure so a stuck purge
    // shows as a failed cron invocation rather than silent KV growth.
    try {
      const result = await provider.purgeExpiredData(env, { batchSize: 100 });
      console.log("oauth purge complete", result);
    } catch (err) {
      console.error("oauth purge failed", err);
      throw err;
    }
  },
} satisfies ExportedHandler<Env>;

// Report errors from the top-level fetch and scheduled handlers (rate limiting, the OAuth
// flow, the cron purge). The user email is not known at this layer (it lives encrypted in
// the OAuth grant), so these events carry the error without it.
export default Sentry.withSentry(sentryOptions, handler);
