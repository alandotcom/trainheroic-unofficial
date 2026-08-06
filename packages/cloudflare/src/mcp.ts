import * as Sentry from "@sentry/cloudflare";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { ExerciseStore, resolveOrgId } from "@trainheroic-unofficial/db";
import { makeD1Warehouse } from "@trainheroic-unofficial/db/d1";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { resolveAthleteUserId } from "@trainheroic-unofficial/js";
import type { Props } from "./types";
import pkg from "../package.json" with { type: "json" };
import type { ToolContext } from "@trainheroic-unofficial/core";
import { registerAnalyticsTools } from "@trainheroic-unofficial/core";
import { registerAthleteTools } from "@trainheroic-unofficial/core";
import { registerAthleteTrainingTools } from "@trainheroic-unofficial/core";
import { registerExerciseTools } from "@trainheroic-unofficial/core";
import { registerMainLiftTools } from "@trainheroic-unofficial/core";
import { registerMessagingTools } from "@trainheroic-unofficial/core";
import { registerReadTools } from "@trainheroic-unofficial/core";
import { SERVER_INSTRUCTIONS } from "@trainheroic-unofficial/core";
import { registerTeamTools } from "@trainheroic-unofficial/core";
import { registerAthleteSyncTools } from "./tools/athlete-sync";
import { registerFeedbackTool } from "./tools/feedback";
import { registerSyncTools } from "./tools/sync";
import { instrumentToolMetrics, recentCallsForUser } from "./tool-metrics";
import { tagMcpUser } from "./sentry";
import { registerWorkoutTools } from "@trainheroic-unofficial/core";

/** Which tool surfaces a server variant exposes. */
export interface SurfaceSelection {
  athlete: boolean;
  coach: boolean;
}

/**
 * The athlete surface: the logged-in user's own training (live tools) plus the D1 history
 * warehouse. Available to every account, because a coach login also carries athlete scope and
 * has its own training data. The user id is resolved once and shared with the warehouse stores.
 */
async function registerAthleteSurface(
  server: McpServer,
  env: Env,
  client: TrainHeroicClient,
): Promise<void> {
  let userId: number | null = null;
  try {
    userId = await resolveAthleteUserId(client);
  } catch {
    /* leave null; the warehouse stores resolve it lazily */
  }
  const warehouse = makeD1Warehouse(env.TH_DB, { instrument: Sentry.instrumentD1WithSentry });
  registerAthleteTrainingTools(server, { client });
  registerAthleteSyncTools(server, warehouse, client, userId);
}

/** The coaching surface: roster/teams/programs/exercises/messaging plus the coach warehouse. */
async function registerCoachSurface(
  server: McpServer,
  env: Env,
  client: TrainHeroicClient,
): Promise<void> {
  let orgId: number | null = null;
  try {
    orgId = await resolveOrgId((method, path) => client.request(method, path));
  } catch {
    /* leave null; stores resolve lazily and throw if still unresolvable */
  }
  const warehouse = makeD1Warehouse(env.TH_DB, { instrument: Sentry.instrumentD1WithSentry });
  const ctx: ToolContext = { client, index: new ExerciseStore(warehouse, client, orgId) };
  registerReadTools(server, ctx);
  registerMainLiftTools(server, ctx);
  registerAthleteTools(server, ctx);
  registerTeamTools(server, ctx);
  registerAnalyticsTools(server, ctx);
  registerExerciseTools(server, ctx);
  registerWorkoutTools(server, ctx);
  registerMessagingTools(server, ctx);
  registerSyncTools(server, warehouse, client, orgId);
}

function readProps(): Props {
  const auth = getMcpAuthContext();
  const props = auth?.props as Props | undefined;
  if (!props?.email || !props.password) {
    throw new Error("Missing authentication context");
  }
  return props;
}

/**
 * Build a fresh MCP server for one request (SDK v2 / createMcpHandler factory).
 * Credentials come from the OAuth grant via {@link getMcpAuthContext}.
 */
export async function createTrainHeroicServer(
  env: Env,
  surfaces: SurfaceSelection,
): Promise<McpServer> {
  const props = readProps();
  const correlationId = `user:${props.thUserId}`;

  Sentry.setUser({ email: props.email });
  tagMcpUser(correlationId);

  const server = new McpServer(
    { name: "trainheroic", version: pkg.version },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const instrumentation = instrumentToolMetrics(server, correlationId, props.thUserId);
  const client = new TrainHeroicClient(props.email, props.password);

  if (surfaces.athlete) {
    instrumentation.surface = "athlete";
    await registerAthleteSurface(server, env, client);
  }
  if (surfaces.coach && props.role === "coach") {
    instrumentation.surface = "coach";
    await registerCoachSurface(server, env, client);
  }

  instrumentation.surface = "system";
  registerFeedbackTool(server, {
    email: props.email,
    role: props.role,
    sessionId: correlationId,
    version: pkg.version,
    release: env.SENTRY_RELEASE,
    recentCalls: () => recentCallsForUser(props.thUserId),
  });

  return server;
}

const HOSTED_HOSTNAMES = ["mcp.trainheroic-unofficial.com"];

/**
 * OAuthProvider-compatible fetch handler for one MCP path variant.
 * Constructs {@link createMcpHandler} per request so the factory closes over `env` (D1).
 */
export function mcpApiHandler(route: string, surfaces: SurfaceSelection) {
  return {
    fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      return createMcpHandler((_) => createTrainHeroicServer(env, surfaces), {
        route,
        allowedHostnames: HOSTED_HOSTNAMES,
        // Accept ordinary legacy tool clients on the same route; MRTR elicitation for
        // legacy sessionful clients still needs confirm:true on this stateless lane.
        legacy: "stateless",
      })(request, env, ctx);
    },
  };
}

export const FULL_SURFACES: SurfaceSelection = { athlete: true, coach: true };
export const COACH_SURFACES: SurfaceSelection = { athlete: false, coach: true };
export const ATHLETE_SURFACES: SurfaceSelection = { athlete: true, coach: false };
