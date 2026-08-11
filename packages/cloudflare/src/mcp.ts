import { env } from "cloudflare:workers";
import * as Sentry from "@sentry/cloudflare";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { ExerciseStore } from "@trainheroic-unofficial/db";
import { makeD1Warehouse } from "@trainheroic-unofficial/db/d1";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import type { AccountRole, Props } from "./types";
import { toAccountRole } from "./types";
import pkg from "../package.json" with { type: "json" };
import type { ToolContext } from "@trainheroic-unofficial/core";
import {
  registerAthleteTrainingTools,
  registerCoachTools,
  SERVER_INSTRUCTIONS,
} from "@trainheroic-unofficial/core";
import { registerAthleteSyncTools } from "./tools/athlete-sync";
import { registerFeedbackTool } from "./tools/feedback";
import { registerSyncTools } from "./tools/sync";
import { instrumentToolMetrics } from "./tool-metrics";
import {
  instrumentMcpServer,
  mcpUserKey,
  tagMcpUser,
  trainHeroicHttpErrorReporter,
} from "./sentry";

/** Path variants exposed by the Worker. `/mcp` is role-aware; the others scope to one surface. */
export type McpVariant = "full" | "coach" | "athlete";

/**
 * TrainHeroic session tokens, kept for the life of the isolate and keyed by the grant's
 * `thUserId`.
 *
 * Why this exists: MCP SDK v2 is stateless, so `createMcpHandler` calls the server factory once
 * per HTTP request. `TrainHeroicClient` caches its session token in a private instance field, so
 * a per-request client means a fresh `POST /auth` before every single tool call — TrainHeroic
 * issues no refresh token, so that is the user's password replayed upstream on each call. The
 * deleted Durable Object used to provide this cache implicitly by outliving the request.
 *
 * The key must be `thUserId` from the *verified* grant and nothing client-supplied: a shared
 * isolate serves every tenant, so a wrong key hands one user's session to another. The token
 * stays in memory only — it is credential-equivalent, and unlike the grant props neither KV nor
 * D1 encrypts it at rest. A stale entry self-heals: `TrainHeroicClient` re-logs in once on a
 * 401/403 and replaces it.
 */
const sessionCache = new Map<number, string>();

/** Bound so a busy isolate cannot grow the cache without limit. Oldest insert is evicted first. */
const MAX_CACHED_SESSIONS = 200;

function cacheSession(thUserId: number, sessionId: string | null): void {
  if (!sessionId) return;
  // Re-inserting moves the key to the end, so the eviction below drops the least recently set.
  sessionCache.delete(thUserId);
  sessionCache.set(thUserId, sessionId);
  if (sessionCache.size > MAX_CACHED_SESSIONS) {
    const oldest = sessionCache.keys().next();
    if (!oldest.done) sessionCache.delete(oldest.value);
  }
}

export function readProps(): Props {
  const props = parseProps(getMcpAuthContext()?.props);
  if (!props) throw new Error("Missing authentication context");
  return props;
}

/**
 * Narrow the OAuth grant's decrypted `props` into {@link Props}, or `undefined` when a
 * load-bearing field is missing.
 *
 * `role` is normalized rather than validated. Grants issued before `toAccountRole` existed
 * stored whatever string TrainHeroic's `/auth` returned (`data.role ?? ""`, so possibly empty),
 * and grant props are encrypted under each token — they can never be migrated. Rejecting an
 * unrecognized role would strand those users on a permanent error with no path back to the
 * consent screen. Coercing is also the fail-closed direction: anything that is not exactly
 * `"coach"` lands on the athlete surface, which grants strictly less.
 */
export function parseProps(value: unknown): Props | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.thUserId !== "number" || !Number.isSafeInteger(v.thUserId) || v.thUserId <= 0)
    return undefined;
  if (typeof v.email !== "string" || v.email.length === 0) return undefined;
  if (typeof v.password !== "string" || v.password.length === 0) return undefined;
  if (typeof v.scope !== "string") return undefined;
  return {
    thUserId: v.thUserId,
    email: v.email,
    password: v.password,
    role: toAccountRole(typeof v.role === "string" ? v.role : ""),
    scope: v.scope,
  };
}

function registerAthleteSurface(
  server: McpServer,
  client: TrainHeroicClient,
  thUserId: number,
): void {
  const warehouse = makeD1Warehouse(env.TH_DB, { instrument: Sentry.instrumentD1WithSentry });
  registerAthleteTrainingTools(server, { client });
  registerAthleteSyncTools(server, warehouse, client, thUserId);
}

function registerCoachSurface(server: McpServer, client: TrainHeroicClient): void {
  const warehouse = makeD1Warehouse(env.TH_DB, { instrument: Sentry.instrumentD1WithSentry });
  // Stores resolve orgId lazily when null.
  const ctx: ToolContext = { client, index: new ExerciseStore(warehouse, client, null) };
  registerCoachTools(server, ctx);
  registerSyncTools(server, warehouse, client, null);
}

/**
 * Which tool surfaces a given path variant exposes for a given account role. This is the
 * authorization boundary that keeps coaching tools away from an athlete account, so it is a pure
 * function of its two inputs and exported for tests.
 */
export function selectSurfaces(
  variant: McpVariant,
  role: AccountRole,
): { athlete: boolean; coach: boolean } {
  return {
    athlete: variant === "full" || variant === "athlete",
    coach: (variant === "full" || variant === "coach") && role === "coach",
  };
}

/**
 * Build a fresh MCP server for one request (SDK v2 factory), with the grant's props injected so
 * the surface decision is reachable from a test without an OAuth round trip. Bindings come from
 * `import { env } from "cloudflare:workers"`.
 */
export function buildServer(variant: McpVariant, props: Props): McpServer {
  const correlationId = mcpUserKey(props.thUserId);

  Sentry.setUser({ email: props.email });
  tagMcpUser(correlationId);

  const server = instrumentMcpServer(
    new McpServer(
      { name: "trainheroic", version: pkg.version },
      { instructions: SERVER_INSTRUCTIONS },
    ),
  );

  const metrics = instrumentToolMetrics(server, correlationId);
  // Seed the client with this user's cached session token so the request skips the login round
  // trip (see sessionCache). `onSession` writes back both the cold login and the post-401 relogin.
  const client = new TrainHeroicClient(
    props.email,
    props.password,
    sessionCache.get(props.thUserId) ?? null,
    {
      onSession: (sessionId) => cacheSession(props.thUserId, sessionId),
      onHttpError: trainHeroicHttpErrorReporter(props.email),
    },
  );

  const { athlete: wantAthlete, coach: wantCoach } = selectSurfaces(variant, props.role);

  if (wantAthlete) {
    metrics.run("athlete", () => registerAthleteSurface(server, client, props.thUserId));
  }
  if (wantCoach) {
    metrics.run("coach", () => registerCoachSurface(server, client));
  }

  metrics.run("system", () => {
    registerFeedbackTool(server, {
      email: props.email,
      role: props.role,
      correlationId,
      version: pkg.version,
      release: env.SENTRY_RELEASE,
    });
  });

  return server;
}

/**
 * Module-level handlers (one per variant). Bindings come from `cloudflare:workers` env.
 * Thin `{ fetch }` adapter so OAuthProvider's apiHandlers get a Worker-shaped handler
 * (StatelessMcpHandler's own `.fetch` takes request options, not Worker env).
 *
 * `allowedHostnames` is deliberately not passed. The Agents wrapper resolves it as
 * `allowedHostnames ?? (localhost defaults | the workers.dev host | no check at all)`, so
 * supplying a list REPLACES those defaults rather than adding to them — pinning the production
 * hostname would 403 `pnpm dev` on localhost:8787 and the workers.dev endpoint DEPLOY.md tells
 * deployers to use. Omitting it keeps the localhost and workers.dev defaults, and for a custom
 * domain leaves the Host guarantee to Cloudflare routing, which is what the option's own docs
 * prescribe.
 */
function makeHandler(route: string, variant: McpVariant) {
  const handler = createMcpHandler(() => buildServer(variant, readProps()), {
    route,
    // createMcpHandler catches every error in the request path and answers 500 without
    // rethrowing, so nothing propagates out to `withSentry` in index.ts. This callback is the
    // only way an MCP-path failure becomes visible; the DO instrumentation used to cover it.
    onerror: (error: unknown) => {
      Sentry.captureException(error, { tags: { "mcp.route": route } });
      console.error("mcp handler error", route, error);
    },
  });
  return {
    fetch(request: Request, workerEnv: Env, ctx: ExecutionContext): Promise<Response> {
      return handler(request, workerEnv, ctx);
    },
  };
}

export const fullMcpHandler = makeHandler("/mcp", "full");
export const coachMcpHandler = makeHandler("/mcp/coach", "coach");
export const athleteMcpHandler = makeHandler("/mcp/athlete", "athlete");
