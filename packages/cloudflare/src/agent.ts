import * as Sentry from "@sentry/cloudflare";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import type { Connection } from "agents";
import { ExerciseStore } from "./store/exercises";
import { resolveOrgId } from "./store/d1";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { resolveAthleteUserId } from "@trainheroic-unofficial/js";
import type { Props } from "./types";
import pkg from "../package.json" with { type: "json" };
import type { ToolContext } from "@trainheroic-unofficial/core";
import { registerAnalyticsTools } from "@trainheroic-unofficial/core";
import { registerAthleteTools } from "@trainheroic-unofficial/core";
import { registerAthleteTrainingTools } from "@trainheroic-unofficial/core";
import { registerExerciseTools } from "@trainheroic-unofficial/core";
import { registerMessagingTools } from "@trainheroic-unofficial/core";
import { registerReadTools } from "@trainheroic-unofficial/core";
import { SERVER_INSTRUCTIONS } from "@trainheroic-unofficial/core";
import { registerTeamTools } from "@trainheroic-unofficial/core";
import { registerAthleteSyncTools } from "./tools/athlete-sync";
import { registerSyncTools } from "./tools/sync";
import { instrumentToolMetrics } from "./tool-metrics";
import { tagMcpSession } from "./sentry";
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

/** Which tool surfaces a server variant exposes. See the three concrete classes below. */
interface SurfaceSelection {
  athlete: boolean;
  coach: boolean;
}

/**
 * The MCP server, one Durable Object instance per client session. Credentials arrive
 * via the end-to-end-encrypted grant `props`; the TrainHeroic session is acquired
 * lazily by the client and cached in memory for the life of the instance.
 *
 * Three concrete variants extend this, bound to three paths (see index.ts / wrangler.jsonc):
 *   - `/mcp`         → {@link TrainHeroicMCP}: the full role-aware surface (athlete for every
 *                       account, plus coaching for a coach account). The production endpoint.
 *   - `/mcp/coach`   → {@link CoachMCP}: only the coaching surface (empty for an athlete account).
 *   - `/mcp/athlete` → {@link AthleteMCP}: only the athlete surface.
 * The coach/athlete variants expose a single tool set, for a user who keeps separate accounts
 * or wants a connection scoped to one role.
 */
abstract class TrainHeroicMCPBase extends McpAgent<Env, State, Props> {
  server = new McpServer(
    { name: "trainheroic", version: pkg.version },
    { instructions: SERVER_INSTRUCTIONS },
  );

  /** The surfaces this variant registers. Coaching still requires a coach account. */
  protected abstract readonly surfaces: SurfaceSelection;

  async init(): Promise<void> {
    const props = this.props;
    if (!props) throw new Error("Missing authentication context");

    // Tag this session's Sentry scope with the user's email (the only user datum we keep) and the
    // opaque session id. `this.name` is the per-session DO name (`streamable-http:<mcp-session-id>`),
    // the value index.ts mirrors at the worker layer so worker and DO spans line up. onError and
    // the tool wrapper (tool-metrics.ts) re-tag for the fresh per-message scopes init() can't reach;
    // see tagMcpSession.
    Sentry.setUser({ email: props.email });
    tagMcpSession(this.name);

    // Patch the registerTool seam before any surface registers, so every tool call emits aggregate
    // usage metrics and tags its trace span with the session id (tool name + surface + ok/error +
    // opaque session id only — no args/results; see tool-metrics.ts). `this.name` is the
    // per-session DO name (`streamable-http:<mcp-session-id>`), an opaque, non-PII session id.
    // Flip `.surface` around each registration block so every tool is tagged with its tool set.
    const instrumentation = instrumentToolMetrics(this.server, this.name);

    const client = new TrainHeroicClient(props.email, props.password);

    if (this.surfaces.athlete) {
      instrumentation.surface = "athlete";
      await registerAthleteSurface(this.server, this.env, client);
    }
    if (this.surfaces.coach && props.role === "coach") {
      instrumentation.surface = "coach";
      await registerCoachSurface(this.server, this.env, client);
    }
  }

  /**
   * The agents runtime funnels websocket, request, and server errors through onError. Each
   * per-message DO invocation runs in its own Sentry isolation scope, so the email and session
   * tag set in init() do not carry to it; setting them here — inside that scope, just before the
   * Sentry DO wrapper captures the rethrown error — keeps the email and `mcp.session` attached to
   * every reported error. We only enrich the scope, then defer to the base handler, which logs
   * and rethrows.
   */
  override onError(connectionOrError: unknown, error?: unknown): void | Promise<void> {
    if (this.props?.email) Sentry.setUser({ email: this.props.email });
    tagMcpSession(this.name);
    return error !== undefined
      ? super.onError(connectionOrError as Connection, error)
      : super.onError(connectionOrError);
  }
}

/** `/mcp`: the full role-aware surface. Athlete for everyone; coaching for a coach account. */
export class TrainHeroicMCP extends TrainHeroicMCPBase {
  protected readonly surfaces = { athlete: true, coach: true };
}

/** `/mcp/coach`: coaching tools only (registers nothing for a non-coach account). */
export class CoachMCP extends TrainHeroicMCPBase {
  protected readonly surfaces = { athlete: false, coach: true };
}

/** `/mcp/athlete`: athlete training tools only. */
export class AthleteMCP extends TrainHeroicMCPBase {
  protected readonly surfaces = { athlete: true, coach: false };
}
