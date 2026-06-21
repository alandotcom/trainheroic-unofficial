import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiCall, errorResult, idParam, READ, toId } from "../context";
import type { ToolContext } from "../context";

// Every analytics category in `analytics_categories` (GET /v5/analytics) is read back
// through a per-instance POST under /v5/analytics/*. They are read-only data pulls despite
// the POST verb. One `metric` enum maps to the endpoint, its scope (team vs athlete), and
// the inputs it accepts. The request shapes below were verified against the live API.

const METRIC_KEYS = [
  "readiness-team",
  "readiness-athlete",
  "lift-1rm-history",
  "training-summary-athlete",
  "compliance-team",
  "lift-progress-team",
  "working-max-history",
] as const;

type Metric = (typeof METRIC_KEYS)[number];
type Input = "date" | "dateStart" | "dateEnd" | "exerciseId" | "useMetric";
type MetricSpec = {
  path: string;
  scope: "team" | "user";
  // camelCase tool inputs this endpoint accepts, and the subset it requires.
  inputs: readonly Input[];
  requires: readonly Input[];
};

const METRICS: Record<Metric, MetricSpec> = {
  "readiness-team": {
    path: "/v5/analytics/readiness/teams",
    scope: "team",
    inputs: ["date"],
    requires: ["date"],
  },
  "readiness-athlete": {
    path: "/v5/analytics/readiness/users",
    scope: "user",
    inputs: ["dateStart", "dateEnd"],
    requires: ["dateStart", "dateEnd"],
  },
  "lift-1rm-history": {
    path: "/v5/analytics/lift-one-rep-max-history/users",
    scope: "user",
    inputs: ["dateStart", "dateEnd", "exerciseId", "useMetric"],
    requires: ["dateStart", "dateEnd", "exerciseId"],
  },
  "training-summary-athlete": {
    path: "/v5/analytics/training-summary/users",
    scope: "user",
    inputs: ["dateStart", "dateEnd"],
    requires: ["dateStart", "dateEnd"],
  },
  "compliance-team": {
    path: "/v5/analytics/compliance",
    scope: "team",
    inputs: ["dateStart", "dateEnd"],
    requires: ["dateStart", "dateEnd"],
  },
  "lift-progress-team": {
    path: "/v5/analytics/lift-progress/teams",
    scope: "team",
    inputs: ["exerciseId", "dateStart", "dateEnd"],
    requires: ["exerciseId", "dateStart", "dateEnd"],
  },
  "working-max-history": {
    path: "/v5/analytics/working-max-history/users",
    scope: "user",
    inputs: ["exerciseId", "dateStart", "dateEnd", "useMetric"],
    requires: ["exerciseId"],
  },
};

const BODY_KEY: Record<Input, string> = {
  date: "date",
  dateStart: "date_start",
  dateEnd: "date_end",
  exerciseId: "exercise_id",
  useMetric: "use_metric",
};

/** Analytics report pulls. Read-only despite the POST verb, so ungated. */
export function registerAnalyticsTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "analytics_query",
    {
      title: "Pull an analytics report",
      description:
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
        "dates are YYYY-MM-DD.",
      inputSchema: {
        metric: z.enum(METRIC_KEYS),
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
    async ({ metric, teamId, userIds, exerciseId, date, dateStart, dateEnd, useMetric }) => {
      const spec = METRICS[metric];
      const inputs: Record<Input, unknown> = { date, dateStart, dateEnd, exerciseId, useMetric };
      const body: Record<string, unknown> = {};
      if (spec.scope === "team") {
        if (teamId === undefined) return errorResult(`${metric} needs teamId.`);
        body.teamId = toId(teamId);
      } else {
        if (userIds === undefined || userIds.length === 0) {
          return errorResult(`${metric} needs userIds (one or more athlete ids).`);
        }
        body.user_ids = userIds.map((u) => String(toId(u)));
      }
      const missing = spec.requires.filter((k) => inputs[k] === undefined);
      if (missing.length > 0) return errorResult(`${metric} also needs: ${missing.join(", ")}.`);
      for (const k of spec.inputs) {
        const v = inputs[k];
        if (v === undefined) continue;
        body[BODY_KEY[k]] = k === "exerciseId" ? String(toId(v as string | number)) : v;
      }
      return apiCall(
        ctx,
        "POST",
        spec.path,
        { body },
        "Narrow with a tighter date range or fewer athletes.",
      );
    },
  );
}
