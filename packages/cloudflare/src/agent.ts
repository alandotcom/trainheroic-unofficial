import * as Sentry from "@sentry/cloudflare";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import type { Connection } from "agents";
import { ExerciseStore } from "./store/exercises";
import { resolveOrgId } from "./store/d1";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import type { Props } from "./types";
import type { ToolContext } from "@trainheroic-unofficial/core";
import { registerAnalyticsTools } from "@trainheroic-unofficial/core";
import { registerAthleteTools } from "@trainheroic-unofficial/core";
import { registerExerciseTools } from "@trainheroic-unofficial/core";
import { registerMessagingTools } from "@trainheroic-unofficial/core";
import { registerReadTools } from "@trainheroic-unofficial/core";
import { registerTeamTools } from "@trainheroic-unofficial/core";
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

    // Tag Sentry events from this session with the user's email (the only user datum we keep).
    // init() runs inside the DO's request scope; onError below re-sets it for the separate
    // per-message scopes that init() does not reach.
    Sentry.setUser({ email: props.email });

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
    registerAthleteTools(this.server, ctx);
    registerTeamTools(this.server, ctx);
    registerAnalyticsTools(this.server, ctx);
    registerExerciseTools(this.server, ctx);
    registerWorkoutTools(this.server, ctx);
    registerMessagingTools(this.server, ctx);
    // Warehouse syncs persist to D1 (hosted only).
    registerSyncTools(this.server, this.env.TH_DB, client, orgId);
  }

  /**
   * The agents runtime funnels websocket, request, and server errors through onError. Each
   * per-message DO invocation runs in its own Sentry isolation scope, so the email set in
   * init() does not carry to it; setting it here — inside that scope, just before the Sentry
   * DO wrapper captures the rethrown error — keeps the email attached to every reported error.
   * We only enrich the scope, then defer to the base handler, which logs and rethrows.
   */
  override onError(connectionOrError: unknown, error?: unknown): void | Promise<void> {
    if (this.props?.email) Sentry.setUser({ email: this.props.email });
    return error !== undefined
      ? super.onError(connectionOrError as Connection, error)
      : super.onError(connectionOrError);
  }
}
