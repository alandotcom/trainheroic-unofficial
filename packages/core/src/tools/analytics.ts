import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ANALYTICS_METRIC_KEYS, definedProps, queryAnalytics } from "@trainheroic-unofficial/js";
import { attempt, idParam, jsonResult, READ, toId } from "../context";
import type { ToolContext } from "../context";

// The analytics metric catalog (keys → endpoint/scope/required inputs) and request-body
// building live in the SDK (`queryAnalytics`), so the MCP tool and the CLI share one source.
// These are read-only data pulls despite the POST verb, so the tool is ungated.

const ANALYTICS_QUERY_DESC =
  "Read a TrainHeroic analytics report. The `metric` enum below IS the catalog — pick from " +
  "it directly (analytics_categories lists the API's raw category names, which do NOT match " +
  "these keys; you rarely need it). Team metrics (readiness-team, compliance-team, " +
  "lift-progress-team) need teamId; athlete metrics (readiness-athlete, " +
  "training-summary-athlete, lift-1rm-history, working-max-history) need userIds — get " +
  "those from list_athletes. userIds takes MANY athletes in ONE call (pass the whole " +
  "roster's ids at once); the report comes back with a row per athlete, so do not loop one " +
  "id per call. For team-wide training volume there is no team summary metric: pass every " +
  "athlete's userId to training-summary-athlete in a single call and the rows cover the " +
  "team. An athlete with no logged sessions in range simply returns no rows (not an error). " +
  "Use that for triage: training-summary-athlete with a single athleteId is the fastest " +
  "'has this athlete trained at all, and when' check — no rows means no logged training in " +
  "range, so don't then fan out blind per-lift athlete_lift_history calls. Despite 'athlete' " +
  "in the name this metric accepts 1–N userIds. " +
  "readiness-team takes a single `date`; every other metric takes dateStart/dateEnd. " +
  "lift-1rm-history, lift-progress-team, and working-max-history also need exerciseId. All " +
  "dates are YYYY-MM-DD.";

/** Analytics report pulls. Read-only despite the POST verb, so ungated. */
export function registerAnalyticsTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "analytics_query",
    {
      title: "Pull an analytics report",
      description: ANALYTICS_QUERY_DESC,
      inputSchema: {
        metric: z.enum(ANALYTICS_METRIC_KEYS),
        teamId: idParam.optional(),
        userIds: z.array(idParam).optional(),
        exerciseId: idParam.optional(),
        date: z.string().optional(),
        dateStart: z.string().optional(),
        dateEnd: z.string().optional(),
        useMetric: z.boolean().optional(),
      },
      annotations: READ,
    },
    ({ metric, teamId, userIds, exerciseId, date, dateStart, dateEnd, useMetric }) =>
      attempt(async () =>
        jsonResult(
          await queryAnalytics(
            ctx.client,
            definedProps({
              metric,
              teamId: teamId !== undefined ? toId(teamId) : undefined,
              userIds: userIds?.map(toId),
              exerciseId: exerciseId !== undefined ? toId(exerciseId) : undefined,
              date,
              dateStart,
              dateEnd,
              useMetric,
            }),
          ),
          { hint: "Narrow with a tighter date range or fewer athletes." },
        ),
      ),
  );
}
