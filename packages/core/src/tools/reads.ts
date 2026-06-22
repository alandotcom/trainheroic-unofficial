import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dateString } from "@trainheroic-unofficial/dto";
import {
  fetchCoachAthleteCalendarSummary,
  fetchExerciseHistoryDetail,
  fetchRosterActivity,
  fetchTeamAthleteIds,
  presentCoachAthleteTraining,
  presentExerciseHistory,
  teamVolume,
} from "@trainheroic-unofficial/js";
import { apiCall, attempt, idParam, jsonResult, READ, toId } from "../context";
import type { ToolContext } from "../context";
import { historyInRange } from "../history";

const ATHLETE_LIFT_HISTORY_DESC =
  "A roster athlete's lift history for ONE exercise: the all-time PR board (liftPRs — each entry " +
  "carries its rep-max label, weight, and the date it was set) plus the dated session series " +
  "(sets, estimated 1RM). This is the coach-side way to answer 'show me <athlete>'s PRs / how is " +
  "<athlete>'s squat trending' — pass athleteId from list_athletes and exerciseId from " +
  "exercise_resolve. There is no cross-exercise PR rollup, so you query one lift at a time, but do " +
  "NOT guess lift names blindly: first call athlete_training for the month(s) of interest — it " +
  "lists every exercise the athlete actually performed (with the exact exercise the program used, " +
  "e.g. 'Clean & Jerk' not 'Clean') — then bring those exerciseIds here. An empty result means " +
  "that lift was not logged. liftPRs stay all-time; pass since/until (YYYY-MM-DD, inclusive) to " +
  "window the session series. raw:true returns the untouched API object.";

const ROSTER_ACTIVITY_DESC =
  "A coach's roster ranked by actual training recency: for each athleteId you pass (from " +
  "list_athletes), the all-time sessionsCount, firstLoggedDate, lastLoggedDate, totalReps and " +
  "totalVolume, sorted most-recently-active first. Use lastLoggedDate — the real training signal — " +
  "NOT list_athletes' daysSinceLastLogin (app-login, not training) to answer 'who is my most " +
  "recently active athlete' (the top row) or 'who is falling behind' (a stale or null " +
  "lastLoggedDate, or low volume). A null lastLoggedDate means the athlete has never logged a " +
  "session. This fans out one lookup per athlete, so for a large org pass only the athletes you " +
  "care about. Then drill into a name with athlete_training (their month) or athlete_lift_history.";

const ATHLETE_TRAINING_DESC =
  "A roster athlete's training for one calendar month (coach-side): one row per session with its " +
  "title, the `logged` flag (the reliable did-they-train signal — true means they logged it), rpe, " +
  "duration (minutes), notes, and the exercises they performed, each with a set summary like " +
  "'5 x 2 @ 205 lb'. Use this to answer 'how has <athlete> been training lately' in ONE call, and " +
  "as the discovery handle a coach otherwise lacks: read the exercise titles here to learn what the " +
  "athlete actually did, then pass the lifts you care about to athlete_lift_history for their dated " +
  "PR board. Pass athleteId from list_athletes and a year + month (1-12); query the current month, " +
  "and the previous month for more history. Sessions are in calendar order within the month (the " +
  "API carries no per-session date). An empty list means no sessions that month.";

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
        "Every athlete on this coach's org roster, across all teams (not scoped to one team; the " +
        "account owner themselves and demo/placeholder athletes are included, so the roster count " +
        "includes you). `daysSinceLastLogin` is app-login recency, not training activity — an " +
        "athlete can have logged in today yet have no logged sessions; null means no login on " +
        "record. For per-team attribution use each athlete's own `groups`/`groupTitles` (the teams " +
        "they are enrolled in) and `teamCount`; there is no per-team roster endpoint or other " +
        "per-athlete team field. To rank athletes by real training recency (most recently active, " +
        "or who is falling behind), pass their ids to roster_activity instead of reading " +
        "daysSinceLastLogin. Optional q (case-insensitive; each whitespace-separated word must " +
        "appear in the record, so 'Kyle Jones' matches a 'Jones, [Demo] Kyle' entry) and limit, " +
        "applied client-side, keep large rosters small.",
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
          // Match on each whitespace-separated token independently (AND), so "Kyle Jones"
          // finds a record stored "Jones, [Demo] Kyle" — a single contiguous-substring match
          // would miss it because first/last name are reordered and interleaved with tags.
          const needles = q
            .toLowerCase()
            .split(/\s+/)
            .filter((t) => t.length > 0);
          rows = rows.filter((row) => {
            const hay = JSON.stringify(row).toLowerCase();
            return needles.every((n) => hay.includes(n));
          });
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
    "roster_activity",
    {
      title: "Roster training activity (recency)",
      description: ROSTER_ACTIVITY_DESC,
      inputSchema: {
        athleteIds: z.array(idParam).min(1),
        useMetric: z.boolean().optional(),
      },
      annotations: READ,
    },
    ({ athleteIds, useMetric }) =>
      attempt(async () =>
        jsonResult(
          await fetchRosterActivity(ctx.client, athleteIds.map(toId), useMetric ?? false),
          {
            hint: "Sorted most-recently-active first; lastLoggedDate null = never logged. The top row is the most recently active athlete.",
          },
        ),
      ),
  );

  server.registerTool(
    "athlete_training",
    {
      title: "Athlete training month (roster)",
      description: ATHLETE_TRAINING_DESC,
      inputSchema: {
        athleteId: idParam,
        year: z.number().int(),
        month: z.number().int().min(1).max(12),
      },
      annotations: READ,
    },
    ({ athleteId, year, month }) =>
      attempt(async () => {
        const raw = await fetchCoachAthleteCalendarSummary(
          ctx.client,
          toId(athleteId),
          year,
          month,
        );
        return jsonResult(presentCoachAthleteTraining(raw, toId(athleteId), year, month), {
          hint: "One session per row for the month. Use the exercise titles to pick lifts, then athlete_lift_history for their PRs.",
        });
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
/** The windowed team-volume read — its own function so registerEntityReads stays under the cap. */
function registerTeamVolume(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "team_volume",
    {
      title: "Team training volume over a date window",
      description:
        "Team-wide training volume (and reps/sessions) scoped to an inclusive YYYY-MM-DD window — " +
        "the date-ranged answer to 'how much did the team train over the last two weeks'. Pass " +
        "either teamId (its roster is resolved automatically) or an explicit athleteIds list (from " +
        "list_athletes); dateStart and dateEnd are required. Returns one row per athlete who logged " +
        "in range plus the rolled-up team totals (volume is in lb). For an all-time, undated " +
        "snapshot use roster_activity instead.",
      inputSchema: {
        teamId: idParam.optional(),
        athleteIds: z.array(idParam).optional(),
        dateStart: dateString,
        dateEnd: dateString,
      },
      annotations: READ,
    },
    ({ teamId, athleteIds, dateStart, dateEnd }) =>
      attempt(async () => {
        const ids =
          athleteIds !== undefined && athleteIds.length > 0
            ? athleteIds.map(toId)
            : teamId !== undefined
              ? await fetchTeamAthleteIds(ctx.client, toId(teamId))
              : [];
        if (ids.length === 0) {
          throw new Error(
            "Provide athleteIds, or a teamId whose roster has athletes. " +
              "No athletes resolved for this team — pass athleteIds from list_athletes instead.",
          );
        }
        return jsonResult(await teamVolume(ctx.client, { athleteIds: ids, dateStart, dateEnd }), {
          hint: "Rows cover only athletes who logged in range; totals roll them up. Narrow the window or athletes to shrink.",
        });
      }),
  );
}

export function registerReadTools(server: McpServer, ctx: ToolContext): void {
  registerRosterReads(server, ctx);
  registerEntityReads(server, ctx);
  registerTeamVolume(server, ctx);
}
