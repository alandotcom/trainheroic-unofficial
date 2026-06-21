import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dateString } from "@trainheroic-unofficial/dto";
import { fetchExerciseHistoryDetail, presentExerciseHistory } from "@trainheroic-unofficial/js";
import { apiCall, attempt, idParam, jsonResult, READ, toId } from "../context";
import type { ToolContext } from "../context";
import { historyInRange } from "../history";

const ATHLETE_LIFT_HISTORY_DESC =
  "A roster athlete's lift history for ONE exercise: the all-time PR board (liftPRs — each entry " +
  "carries its rep-max label, weight, and the date it was set) plus the dated session series " +
  "(sets, estimated 1RM). This is the coach-side way to answer 'show me <athlete>'s PRs / how is " +
  "<athlete>'s squat trending' — pass athleteId from list_athletes and exerciseId from " +
  "exercise_resolve. There is no cross-exercise PR summary, so query each lift you care about " +
  "(squat, bench, deadlift, …) and an empty result just means the athlete has not logged that " +
  "lift. liftPRs stay all-time; pass since/until (YYYY-MM-DD, inclusive) to window the session " +
  "series. raw:true returns the untouched API object.";

function enc(value: string | number): string {
  return encodeURIComponent(String(value));
}

/** No-argument GET endpoints, registered from a table to keep the wiring compact. */
const SIMPLE_GETS: ReadonlyArray<{
  name: string;
  title: string;
  description: string;
  path: string;
}> = [
  {
    name: "whoami",
    title: "Who am I",
    description:
      "The authenticated TrainHeroic coach profile (id, org_id, name, roles, trial days).",
    path: "/user/simple",
  },
  {
    name: "head_coach",
    title: "Head coach / org",
    description: "Org, license, and trial status for the head coach account.",
    path: "/v5/headCoach",
  },
  {
    name: "list_programs",
    title: "List programs",
    description:
      "Coach programs (standalone only). This is often empty even for an active coach, because " +
      "most programming lives as a team's group-program: if it returns [], call list_teams and " +
      "read each team's group_program — do not conclude the coach has no programs.",
    path: "/1.0/coach/programs",
  },
  {
    name: "notifications",
    title: "Notification counts",
    description: "Unread counts including countMessagingNotViewed (cheap 'anything new?' poll).",
    path: "/v5/notifications/counts",
  },
  {
    name: "analytics_categories",
    title: "Analytics categories",
    description:
      "TrainHeroic's raw analytics catalog. Its keys are the API's own names and do NOT match " +
      "analytics_query's `metric` values — choose the metric straight from analytics_query's " +
      "(self-describing) enum instead; you rarely need this tool.",
    path: "/v5/analytics",
  },
];

/** Roster-level reads: the fixed GETs plus the filterable athlete and team lists. */
function registerRosterReads(server: McpServer, ctx: ToolContext): void {
  for (const t of SIMPLE_GETS) {
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: {}, annotations: READ },
      () => apiCall(ctx, "GET", t.path),
    );
  }

  server.registerTool(
    "list_athletes",
    {
      title: "List athletes",
      description:
        "Every athlete on this coach's org roster, across all teams (not scoped to one team, and " +
        "demo/placeholder athletes are included). `daysSinceLastLogin` is app-login recency, not " +
        "training activity — an athlete can have logged in today yet have no logged sessions; " +
        "null means no login on record. There is no per-athlete team field here, so to attribute " +
        "athletes to a team use the team's roster. Optional q (case-insensitive substring filter " +
        "over each athlete record) and limit, applied client-side, to keep large rosters small.",
      inputSchema: {
        q: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
      },
      annotations: READ,
    },
    ({ q, limit }) =>
      attempt(async () => {
        const res = await ctx.client.request("GET", "/v5/athletes");
        if (!res.ok) {
          const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
          throw new Error(`TrainHeroic API error (HTTP ${res.status}): ${detail}`);
        }
        if (!Array.isArray(res.data)) return jsonResult(res.data);
        let rows = res.data as unknown[];
        if (q !== undefined) {
          const needle = q.toLowerCase();
          rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle));
        }
        const total = rows.length;
        if (limit !== undefined && rows.length > limit) {
          return jsonResult({
            items: rows.slice(0, limit),
            returned: limit,
            total,
            note: "Limited client-side. Raise limit or narrow with q for the rest.",
          });
        }
        return jsonResult(rows, {
          hint: "Filter with q (name/email substring) or cap with limit to shrink this list.",
        });
      }),
  );

  server.registerTool(
    "list_teams",
    {
      title: "List teams",
      description:
        "Coach teams. The headcount fields are easy to misread: member_count and athlete_count " +
        "are enrolled-athlete counts and are commonly 0 (a coach-built team with no enrolled " +
        "members), while athleteIds typically holds just the owner's id, NOT the full roster. " +
        "For who is actually on the roster use list_athletes (org-wide). Each team's group_program " +
        "id is the team's programming. Optional pagination and search.",
      inputSchema: {
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().positive().optional(),
        q: z.string().optional(),
      },
      annotations: READ,
    },
    ({ page, pageSize, q }) => {
      const qs = new URLSearchParams();
      if (page !== undefined) qs.set("page", String(page));
      if (pageSize !== undefined) qs.set("pageSize", String(pageSize));
      if (q !== undefined) qs.set("q", q);
      const query = qs.toString();
      return apiCall(ctx, "GET", `/1.0/coach/teams${query ? `?${query}` : ""}`);
    },
  );
}

/** Reads scoped to a single entity (team, program, athlete) plus the activity feed. */
function registerEntityReads(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_team",
    {
      title: "Get team",
      description: "Full team object by team id.",
      inputSchema: { teamId: idParam },
      annotations: READ,
    },
    ({ teamId }) => apiCall(ctx, "GET", `/v5/teams/${enc(teamId)}`),
  );

  server.registerTool(
    "list_team_codes",
    {
      title: "List team access codes",
      description: "Join/access codes for a team.",
      inputSchema: { teamId: idParam },
      annotations: READ,
    },
    ({ teamId }) => apiCall(ctx, "GET", `/v5/teams/${enc(teamId)}/teamCodes`),
  );

  server.registerTool(
    "athlete_lift_history",
    {
      title: "Athlete lift history + PRs (roster)",
      description: ATHLETE_LIFT_HISTORY_DESC,
      inputSchema: {
        athleteId: idParam,
        exerciseId: idParam,
        raw: z.boolean().optional(),
        since: dateString.optional(),
        until: dateString.optional(),
      },
      annotations: READ,
    },
    ({ athleteId, exerciseId, raw, since, until }) =>
      attempt(async () => {
        const detail = await fetchExerciseHistoryDetail(
          ctx.client,
          toId(exerciseId),
          toId(athleteId),
        );
        if (raw === true) return jsonResult(detail);
        return jsonResult(historyInRange(presentExerciseHistory(detail), since, until));
      }),
  );

  server.registerTool(
    "get_program",
    {
      title: "Get program detail",
      description:
        "Full nested program structure (blocks + sessions) live from the API, by program id.",
      inputSchema: { programId: idParam },
      annotations: READ,
    },
    ({ programId }) =>
      apiCall(
        ctx,
        "GET",
        `/3.0/coach/program/${enc(programId)}`,
        undefined,
        "This is a large, deep object. If it is truncated, fetch a narrower view (a specific session) instead.",
      ),
  );
}

/** Read-only coach/athlete queries. Exercise lookups live in the exercise store tools. */
export function registerReadTools(server: McpServer, ctx: ToolContext): void {
  registerRosterReads(server, ctx);
  registerEntityReads(server, ctx);
}
