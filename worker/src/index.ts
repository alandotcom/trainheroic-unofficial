import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { authHandler } from "./auth/handler";
import { TrainHeroicMCP } from "./mcp/agent";

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
    // KV hygiene: drop expired/orphaned grants, tokens, and client registrations.
    await provider.purgeExpiredData(env, { batchSize: 100 });
  },
} satisfies ExportedHandler<Env>;
