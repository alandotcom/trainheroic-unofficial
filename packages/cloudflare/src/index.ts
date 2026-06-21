import * as Sentry from "@sentry/cloudflare";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { authHandler } from "./auth/handler";
import {
  AthleteMCP as AthleteMCPBase,
  CoachMCP as CoachMCPBase,
  TrainHeroicMCP as TrainHeroicMCPBase,
} from "./agent";
import { mcpSessionKey, sentryOptions, tagMcpSession } from "./sentry";

// Durable Object exports (referenced by the wrangler migrations + bindings). Each is wrapped with
// Sentry so errors thrown inside the DO — init, transport, tool dispatch — are reported with the
// session's user email attached. The wrapper is a Proxy over the class; the wrangler binding's
// class_name resolves to these exported names, and the static `serve` below passes through the
// Proxy untouched. The three variants expose different tool sets at three paths (see below).
export const TrainHeroicMCP = Sentry.instrumentDurableObjectWithSentry(
  sentryOptions,
  TrainHeroicMCPBase,
);
export const CoachMCP = Sentry.instrumentDurableObjectWithSentry(sentryOptions, CoachMCPBase);
export const AthleteMCP = Sentry.instrumentDurableObjectWithSentry(sentryOptions, AthleteMCPBase);

const provider = new OAuthProvider({
  // Most specific routes first: `apiHandlers` is matched by prefix in insertion order, so
  // `/mcp/coach` and `/mcp/athlete` must precede `/mcp` or they'd be swallowed by it.
  //   /mcp         → full role-aware surface (production)
  //   /mcp/coach   → coaching tools only        } a single tool set, for separate accounts or
  //   /mcp/athlete → athlete training tools only } a connection scoped to one role
  apiHandlers: {
    "/mcp/coach": CoachMCP.serve("/mcp/coach", { binding: "MCP_OBJECT_COACH" }),
    "/mcp/athlete": AthleteMCP.serve("/mcp/athlete", { binding: "MCP_OBJECT_ATHLETE" }),
    "/mcp": TrainHeroicMCP.serve("/mcp", { binding: "MCP_OBJECT" }),
  },
  defaultHandler: authHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
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
    // Tag the worker-level request span with the session, so the GET stream and the POST tool-call
    // requests for one MCP session filter together in the trace explorer (alongside the matching
    // DO-side tags). Only /mcp* carries this header; everything else stays untagged.
    const sessionId = request.headers.get("mcp-session-id");
    if (sessionId) tagMcpSession(mcpSessionKey(sessionId));
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
// flow, the cron purge). Errors inside the MCP Durable Object are reported separately by the
// instrumented export above. The user email is not known at this layer (it lives encrypted in
// the OAuth grant), so these events carry the error without it.
export default Sentry.withSentry(sentryOptions, handler);
