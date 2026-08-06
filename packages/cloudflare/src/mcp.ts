import { env } from "cloudflare:workers";
import * as Sentry from "@sentry/cloudflare";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { ExerciseStore } from "@trainheroic-unofficial/db";
import { makeD1Warehouse } from "@trainheroic-unofficial/db/d1";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import type { Props } from "./types";
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
import { mcpUserKey, tagMcpUser } from "./sentry";

/** Path variants exposed by the Worker. `/mcp` is role-aware; the others scope to one surface. */
export type McpVariant = "full" | "coach" | "athlete";

/** Production Host for MCP. Localhost / workers.dev are already allowed by the Agents wrapper. */
const PRODUCTION_MCP_HOSTNAME = "mcp.trainheroic-unofficial.com";

function readProps(): Props {
  const auth = getMcpAuthContext();
  const props = auth?.props;
  if (!isProps(props)) throw new Error("Missing authentication context");
  return props;
}

function isProps(value: unknown): value is Props {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.thUserId === "number" &&
    typeof v.email === "string" &&
    v.email.length > 0 &&
    typeof v.password === "string" &&
    v.password.length > 0 &&
    (v.role === "coach" || v.role === "athlete") &&
    typeof v.scope === "string"
  );
}

function registerAthleteSurface(server: McpServer, client: TrainHeroicClient): void {
  const warehouse = makeD1Warehouse(env.TH_DB, { instrument: Sentry.instrumentD1WithSentry });
  registerAthleteTrainingTools(server, { client });
  // Stores resolve userId lazily when null.
  registerAthleteSyncTools(server, warehouse, client, null);
}

function registerCoachSurface(server: McpServer, client: TrainHeroicClient): void {
  const warehouse = makeD1Warehouse(env.TH_DB, { instrument: Sentry.instrumentD1WithSentry });
  // Stores resolve orgId lazily when null.
  const ctx: ToolContext = { client, index: new ExerciseStore(warehouse, client, null) };
  registerCoachTools(server, ctx);
  registerSyncTools(server, warehouse, client, null);
}

/**
 * Build a fresh MCP server for one request (SDK v2 factory).
 * Credentials come from the OAuth grant via {@link getMcpAuthContext}; bindings via
 * `import { env } from "cloudflare:workers"`.
 */
function createTrainHeroicServer(variant: McpVariant): McpServer {
  const props = readProps();
  const correlationId = mcpUserKey(props.thUserId);

  Sentry.setUser({ email: props.email });
  tagMcpUser(correlationId);

  const server = new McpServer(
    { name: "trainheroic", version: pkg.version },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const metrics = instrumentToolMetrics(server, correlationId);
  const client = new TrainHeroicClient(props.email, props.password);

  const wantAthlete = variant === "full" || variant === "athlete";
  const wantCoach = (variant === "full" || variant === "coach") && props.role === "coach";

  if (wantAthlete) {
    metrics.run("athlete", () => registerAthleteSurface(server, client));
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
 */
function makeHandler(route: string, variant: McpVariant) {
  const handler = createMcpHandler(() => createTrainHeroicServer(variant), {
    route,
    allowedHostnames: [PRODUCTION_MCP_HOSTNAME],
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
