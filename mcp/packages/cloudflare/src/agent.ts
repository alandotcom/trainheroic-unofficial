import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { ExerciseStore } from "./store/exercises";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import type { Props } from "./types";
import type { ToolContext } from "@trainheroic-unofficial/core";
import { registerExerciseTools } from "@trainheroic-unofficial/core";
import { registerMessagingTools } from "@trainheroic-unofficial/core";
import { registerReadTools } from "@trainheroic-unofficial/core";
import { registerRawTools } from "@trainheroic-unofficial/core";
import { registerSyncTools } from "./tools/sync";
import { registerWorkoutTools } from "@trainheroic-unofficial/core";

type State = Record<string, never>;

/**
 * The MCP server, one Durable Object instance per client session. Credentials arrive
 * via the end-to-end-encrypted grant `props`; the TrainHeroic session is acquired
 * lazily by the client and cached in memory for the life of the instance.
 */
export class TrainHeroicMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({ name: "trainheroic", version: "0.1.0" });

  async init(): Promise<void> {
    const props = this.props;
    if (!props) throw new Error("Missing authentication context");

    const client = new TrainHeroicClient(props.email, props.password);
    const ctx: ToolContext = { client, index: new ExerciseStore(this.env.TH_DB, client) };

    registerReadTools(this.server, ctx);
    registerRawTools(this.server, ctx);
    registerExerciseTools(this.server, ctx);
    registerWorkoutTools(this.server, ctx);
    registerMessagingTools(this.server, ctx);
    // Warehouse syncs persist to D1 (hosted only).
    registerSyncTools(this.server, this.env.TH_DB, client);
  }
}
