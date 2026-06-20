import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { ExerciseStore } from "./store/exercises";
import { resolveOrgId } from "./store/d1";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { resolveAthleteUserId } from "@trainheroic-unofficial/js";
import type { Props } from "./types";
import type { ToolContext } from "@trainheroic-unofficial/core";
import { registerAnalyticsTools } from "@trainheroic-unofficial/core";
import { registerAthleteTools } from "@trainheroic-unofficial/core";
import { registerAthleteTrainingTools } from "@trainheroic-unofficial/core";
import { registerExerciseTools } from "@trainheroic-unofficial/core";
import { registerMessagingTools } from "@trainheroic-unofficial/core";
import { registerReadTools } from "@trainheroic-unofficial/core";
import { registerTeamTools } from "@trainheroic-unofficial/core";
import { registerAthleteSyncTools } from "./tools/athlete-sync";
import { registerSyncTools } from "./tools/sync";
import { registerWorkoutTools } from "@trainheroic-unofficial/core";

type State = Record<string, never>;

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
  registerAthleteTrainingTools(server, { client });
  registerAthleteSyncTools(server, env.TH_DB, client, userId);
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
  const ctx: ToolContext = { client, index: new ExerciseStore(env.TH_DB, client, orgId) };
  registerReadTools(server, ctx);
  registerAthleteTools(server, ctx);
  registerTeamTools(server, ctx);
  registerAnalyticsTools(server, ctx);
  registerExerciseTools(server, ctx);
  registerWorkoutTools(server, ctx);
  registerMessagingTools(server, ctx);
  // Warehouse syncs persist to D1 (hosted only).
  registerSyncTools(server, env.TH_DB, client, orgId);
}

/**
 * The MCP server, one Durable Object instance per client session. Credentials arrive
 * via the end-to-end-encrypted grant `props`; the TrainHeroic session is acquired
 * lazily by the client and cached in memory for the life of the instance. Tools are
 * registered by role: every account gets the athlete surface; coach accounts also get
 * the coaching surface.
 */
export class TrainHeroicMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({ name: "trainheroic", version: "0.1.0" });

  async init(): Promise<void> {
    const props = this.props;
    if (!props) throw new Error("Missing authentication context");

    const client = new TrainHeroicClient(props.email, props.password);

    await registerAthleteSurface(this.server, this.env, client);
    if (props.role === "coach") {
      await registerCoachSurface(this.server, this.env, client);
    }
  }
}
