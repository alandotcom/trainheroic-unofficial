// Coach write/query operations that carry real request-shaping logic, owned here so the MCP
// tools (core) and the CLI share one implementation rather than duplicating it. Thin
// single-request CRUD (team create/update/delete, team-code, archive/restore, session
// unpublish/save-as-template) is left to the callers' own `request`/`apiCall` — there is no
// behavior to centralize there.

import { parseWorkoutDate } from "@trainheroic-unofficial/dto";
import type { TeamVolumeAthlete, TeamVolumeReport } from "@trainheroic-unofficial/dto";
import type { TrainHeroicClient } from "./client";

export const DEFAULT_INVITE_MESSAGE = "Follow these steps and you'll be set up and ready to go!";

/** Normalize one-or-many emails into a deduped, trimmed list. */
function emailList(emails: readonly string[]): string[] {
  return [...new Set(emails.map((e) => e.trim()).filter((e) => e.length > 0))];
}

/**
 * Invite athletes to a team — TrainHeroic's two-step "create athlete" flow: validate the
 * addresses (`POST /v5/emails/validate`), then invite the validated ones
 * (`POST /v5/athletes/inviteToTeam`). Throws with the API detail on failure.
 */
export async function inviteAthletes(
  client: TrainHeroicClient,
  args: { teamId: number; emails: readonly string[]; message?: string },
): Promise<{ teamId: number; invited: string[]; result: unknown }> {
  const list = emailList(args.emails);
  if (list.length === 0) throw new Error("Provide at least one email address to invite.");

  const validation = await client.request("POST", "/v5/emails/validate", {
    body: { emails: list.join(",") },
  });
  if (!validation.ok) {
    const detail =
      typeof validation.data === "string" ? validation.data : JSON.stringify(validation.data);
    throw new Error(`Email validation failed (HTTP ${validation.status}): ${detail}`);
  }
  const valid = Array.isArray(validation.data) ? (validation.data as string[]) : list;
  if (valid.length === 0) {
    throw new Error(
      `No valid addresses among: ${list.join(", ")}. They may be malformed or already on the team.`,
    );
  }

  const invite = await client.request("POST", "/v5/athletes/inviteToTeam", {
    body: {
      teamType: 0,
      teamId: args.teamId,
      orgId: null,
      emails: valid,
      message: args.message ?? DEFAULT_INVITE_MESSAGE,
    },
  });
  if (!invite.ok) {
    const detail = typeof invite.data === "string" ? invite.data : JSON.stringify(invite.data);
    throw new Error(`Invite failed (HTTP ${invite.status}): ${detail}`);
  }
  return { teamId: args.teamId, invited: valid, result: invite.data };
}

/**
 * Copy/repeat a session to a target date on a program (`POST /2.0/coach/calendar/copyProgramWorkout`).
 * The API wants the target date as a structured object (with weekday and an isToday flag),
 * which is computed here from `toDate` (YYYY-M-D). Creates a new (unpublished) session.
 */
export async function copySession(
  client: TrainHeroicClient,
  args: { toProgramId: number; pwId: number; toDate: string },
): Promise<unknown> {
  const [year, month, day] = parseWorkoutDate(args.toDate);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const res = await client.request("POST", "/2.0/coach/calendar/copyProgramWorkout", {
    body: {
      toProgramId: args.toProgramId,
      pwId: args.pwId,
      toDate: { date: iso, day, month, year, dayOfWeek, isToday: false },
    },
  });
  if (!res.ok) throw new Error(`Copy session failed (HTTP ${res.status}).`);
  return res.data;
}

// --- Analytics ----------------------------------------------------------------------------

// Every analytics category (GET /v5/analytics) is read back through a per-instance POST under
// /v5/analytics/*. They are read-only data pulls despite the POST verb. One `metric` key maps
// to the endpoint, its scope (team vs athlete), and the inputs it accepts. Verified live.

export const ANALYTICS_METRIC_KEYS = [
  "readiness-team",
  "readiness-athlete",
  "lift-1rm-history",
  "training-summary-athlete",
  "compliance-team",
  "lift-progress-team",
  "working-max-history",
] as const;

export type AnalyticsMetric = (typeof ANALYTICS_METRIC_KEYS)[number];
type AnalyticsInput = "date" | "dateStart" | "dateEnd" | "exerciseId" | "useMetric";
type MetricSpec = {
  path: string;
  scope: "team" | "user";
  inputs: readonly AnalyticsInput[];
  requires: readonly AnalyticsInput[];
};

const ANALYTICS_METRICS: Record<AnalyticsMetric, MetricSpec> = {
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

/**
 * A serializable description of every analytics metric: its scope (does it need a `teamId` or
 * `userIds`) and which date/exercise inputs it requires vs. optionally accepts. The CLI/MCP
 * surface this so an agent picks a valid `metric` + params up front, instead of discovering the
 * shape by trial and error. These curated keys are deliberately NOT the raw category names from
 * `GET /v5/analytics`; this catalog is the source of truth for `analytics-query`.
 */
export function analyticsMetricCatalog(): Array<{
  metric: AnalyticsMetric;
  scope: "team" | "user";
  scopeParam: "teamId" | "userIds";
  requires: string[];
  optional: string[];
}> {
  return ANALYTICS_METRIC_KEYS.map((metric) => {
    const spec = ANALYTICS_METRICS[metric];
    return {
      metric,
      scope: spec.scope,
      scopeParam: spec.scope === "team" ? "teamId" : "userIds",
      requires: [...spec.requires],
      optional: spec.inputs.filter((i) => !spec.requires.includes(i)),
    };
  });
}

const ANALYTICS_BODY_KEY: Record<AnalyticsInput, string> = {
  date: "date",
  dateStart: "date_start",
  dateEnd: "date_end",
  exerciseId: "exercise_id",
  useMetric: "use_metric",
};

export type AnalyticsQueryArgs = {
  metric: AnalyticsMetric;
  teamId?: number;
  userIds?: readonly number[];
  exerciseId?: number;
  date?: string;
  dateStart?: string;
  dateEnd?: string;
  useMetric?: boolean;
};

/**
 * Build the request body for an analytics metric and POST it. Team metrics need `teamId`;
 * athlete metrics need one or more `userIds` (passed together — the report returns a row per
 * athlete). Throws a readable Error when a required input is missing or the call fails.
 */
export async function queryAnalytics(
  client: TrainHeroicClient,
  args: AnalyticsQueryArgs,
): Promise<unknown> {
  const spec = ANALYTICS_METRICS[args.metric];
  const body: Record<string, unknown> = {};
  if (spec.scope === "team") {
    if (args.teamId === undefined) throw new Error(`${args.metric} needs teamId.`);
    body.teamId = args.teamId;
  } else {
    if (args.userIds === undefined || args.userIds.length === 0) {
      throw new Error(`${args.metric} needs userIds (one or more athlete ids).`);
    }
    body.user_ids = args.userIds.map((u) => String(u));
  }
  const inputs: Record<AnalyticsInput, unknown> = {
    date: args.date,
    dateStart: args.dateStart,
    dateEnd: args.dateEnd,
    exerciseId: args.exerciseId,
    useMetric: args.useMetric,
  };
  const missing = spec.requires.filter((k) => inputs[k] === undefined);
  if (missing.length > 0) throw new Error(`${args.metric} also needs: ${missing.join(", ")}.`);
  for (const k of spec.inputs) {
    const v = inputs[k];
    if (v === undefined) continue;
    body[ANALYTICS_BODY_KEY[k]] = k === "exerciseId" ? String(v) : v;
  }
  const res = await client.request("POST", spec.path, { body });
  if (!res.ok) throw new Error(`Analytics ${args.metric} failed (HTTP ${res.status}).`);
  return res.data;
}

/**
 * Resolve a team's roster to athlete user ids. `/v5/athletes` is the org-wide roster and the only
 * place per-team membership lives (each row's `groups` holds the team/group ids it belongs to);
 * there is no per-team roster endpoint. Returns the ids of athletes whose `groups` include the
 * given id, matched as a string. Throws when the roster fetch fails.
 */
export async function fetchTeamAthleteIds(
  client: TrainHeroicClient,
  teamId: number,
): Promise<number[]> {
  const res = await client.request<unknown>("GET", "/v5/athletes");
  if (!res.ok) throw new Error(`List athletes failed (HTTP ${res.status}).`);
  const rows = Array.isArray(res.data) ? res.data : [];
  const want = String(teamId);
  const ids: number[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const rec = row as { id?: number | string; groups?: unknown };
    const groups = Array.isArray(rec.groups) ? rec.groups.map((g) => String(g)) : [];
    if (!groups.includes(want)) continue;
    const id = typeof rec.id === "string" ? Number(rec.id) : rec.id;
    if (typeof id === "number" && Number.isFinite(id)) ids.push(id);
  }
  return ids;
}

/** One row of the `training-summary-athlete` report — a single logged session. */
type TrainingSummaryRow = {
  user_id?: number | string;
  name_first?: string;
  name_last?: string;
  date_completed?: string;
  reps?: number | string;
  volume?: number | string;
};

function toNum(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Team-wide training volume over an inclusive date window. The `training-summary-athlete`
 * analytics report already returns the team in one call — one row per logged session across all
 * `athleteIds` — so this fans nothing out: it queries once, groups rows by athlete (summing
 * volume/reps and counting sessions), and rolls the athletes up into a team total. Athletes who
 * logged nothing in range simply have no rows and are omitted. The windowed counterpart to the
 * all-time `fetchRosterActivity` snapshot, which has no date range.
 */
export async function teamVolume(
  client: TrainHeroicClient,
  args: { athleteIds: readonly number[]; dateStart: string; dateEnd: string },
): Promise<TeamVolumeReport> {
  if (args.athleteIds.length === 0) throw new Error("teamVolume needs at least one athleteId.");
  const report = await queryAnalytics(client, {
    metric: "training-summary-athlete",
    userIds: args.athleteIds,
    dateStart: args.dateStart,
    dateEnd: args.dateEnd,
  });
  const rows: TrainingSummaryRow[] =
    report !== null &&
    typeof report === "object" &&
    Array.isArray((report as { rows?: unknown }).rows)
      ? (report as { rows: TrainingSummaryRow[] }).rows
      : [];

  const byAthlete = new Map<number, TeamVolumeAthlete>();
  for (const row of rows) {
    const athleteId = toNum(row.user_id);
    if (athleteId === 0) continue;
    const date = typeof row.date_completed === "string" ? row.date_completed.slice(0, 10) : null;
    const name =
      [row.name_first, row.name_last].filter((s) => typeof s === "string" && s !== "").join(" ") ||
      null;
    const existing = byAthlete.get(athleteId);
    if (existing) {
      existing.sessions += 1;
      existing.reps += toNum(row.reps);
      existing.volume += toNum(row.volume);
      if (date !== null) {
        if (existing.firstLoggedDate === null || date < existing.firstLoggedDate)
          existing.firstLoggedDate = date;
        if (existing.lastLoggedDate === null || date > existing.lastLoggedDate)
          existing.lastLoggedDate = date;
      }
    } else {
      byAthlete.set(athleteId, {
        athleteId,
        name,
        sessions: 1,
        reps: toNum(row.reps),
        volume: toNum(row.volume),
        firstLoggedDate: date,
        lastLoggedDate: date,
      });
    }
  }

  const athletes = [...byAthlete.values()].sort((a, b) => b.volume - a.volume);
  const totals = athletes.reduce(
    (acc, a) => ({
      athletes: acc.athletes + 1,
      sessions: acc.sessions + a.sessions,
      reps: acc.reps + a.reps,
      volume: acc.volume + a.volume,
    }),
    { athletes: 0, sessions: 0, reps: 0, volume: 0 },
  );

  return { window: { start: args.dateStart, end: args.dateEnd }, athletes, totals };
}
