import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { authHandler } from "./auth/handler";
import { TrainHeroicMCP } from "./agent";

// Durable Object export (referenced by the wrangler migration + binding).
export { TrainHeroicMCP };

const provider = new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: TrainHeroicMCP.serve("/mcp", { binding: "MCP_OBJECT" }),
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

export default {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    if (await isRateLimited(request, env)) return tooManyRequests();
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
