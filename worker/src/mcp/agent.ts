import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { TrainHeroicClient } from "../trainheroic/client";
import type { Props } from "../types";
import type { ToolContext } from "./context";
import { registerExerciseTools } from "./tools/exercises";
import { registerMessagingTools } from "./tools/messaging";
import { registerReadTools } from "./tools/reads";
import { registerRawTools } from "./tools/raw";
import { registerSyncTools } from "./tools/sync";
import { registerWorkoutTools } from "./tools/workout";

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

    const ctx: ToolContext = {
      client: new TrainHeroicClient(props.email, props.password),
      db: this.env.TH_DB,
      props,
    };

    registerReadTools(this.server, ctx);
    registerRawTools(this.server, ctx);
    registerExerciseTools(this.server, ctx);
    registerWorkoutTools(this.server, ctx);
    registerSyncTools(this.server, ctx);
    registerMessagingTools(this.server, ctx);
  }
}
