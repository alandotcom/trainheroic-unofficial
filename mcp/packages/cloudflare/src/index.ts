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

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> =>
    provider.fetch(request, env, ctx),
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
