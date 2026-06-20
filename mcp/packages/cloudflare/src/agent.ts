import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { ExerciseStore } from "./store/exercises";
import { resolveOrgId } from "./store/d1";
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

    // Resolve the tenant org once and share it across every store, instead of each store
    // re-deriving it from /user/simple. Best-effort: if it fails here the stores fall back
    // to lazy resolution (and still refuse to bind a query to a bad org).
    let orgId: number | null = null;
    try {
      orgId = await resolveOrgId((method, path) => client.request(method, path));
    } catch {
      /* leave null; stores resolve lazily and throw if still unresolvable */
    }

    const ctx: ToolContext = { client, index: new ExerciseStore(this.env.TH_DB, client, orgId) };

    registerReadTools(this.server, ctx);
    registerRawTools(this.server, ctx);
    registerExerciseTools(this.server, ctx);
    registerWorkoutTools(this.server, ctx);
    registerMessagingTools(this.server, ctx);
    // Warehouse syncs persist to D1 (hosted only).
    registerSyncTools(this.server, this.env.TH_DB, client, orgId);
  }
}
