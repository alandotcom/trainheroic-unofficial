// Coach write/query operations that carry real request-shaping logic, owned here so the MCP
// tools (core) and the CLI share one implementation rather than duplicating it. Thin
// single-request CRUD with no response-shaping logic (team create/delete, team-code,
// archive/restore, session unpublish/save-as-template) is left to the callers' own
// `request`/`apiCall`. Program creation lives here because its two returned ids have different
// meanings. Program deletion lives here because `DELETE /v5/programs/{id}` 401s on a
// list_programs container id and must use the underlying program id. Team update lives here
// because re-pointing `group_program` requires a title (API 400 without one), so we may need a
// GET-then-PUT.

import { parseWorkoutDate, programCreateResponseSchema } from "@trainheroic-unofficial/dto";
import type { TeamVolumeAthlete, TeamVolumeReport } from "@trainheroic-unofficial/dto";
import type { TrainHeroicClient } from "./client";
import { coerceInt, isRecord } from "./exercise-util";
import { checkResponse } from "./response-check";
import { calendarWriteError } from "./workout-session";

export const DEFAULT_INVITE_MESSAGE = "Follow these steps and you'll be set up and ready to go!";

export const PROGRAM_KINDS = ["calendar", "fixed"] as const;
export type ProgramKind = (typeof PROGRAM_KINDS)[number];

export type CreatedProgram = {
  /** Container/group id returned by list_programs and used by calendar edit/sync endpoints. */
  containerId: number;
  /** Actual program id used by get_program, workout creation, and other program-scoped writes. */
  programId: number;
  /** Title TrainHeroic actually assigned. The current API may ignore the requested name. */
  title: string;
  kind: ProgramKind;
  requestedName: string;
  nameApplied: boolean;
};

/**
 * Create a standalone ongoing calendar or fixed-length program.
 *
 * TrainHeroic returns both a container id and the underlying program id. They are deliberately
 * named separately here because `/3.0/coach/program/{containerId}` returns 401, while the
 * `programId` works. This write is not idempotent: callers must not blindly retry an uncertain
 * result. The live API currently accepts `name` but may generate its own title; `nameApplied`
 * reports what happened.
 */
export async function createProgram(
  client: TrainHeroicClient,
  args: { kind: ProgramKind; name: string },
): Promise<CreatedProgram> {
  if (!(PROGRAM_KINDS as readonly string[]).includes(args.kind)) {
    throw new Error(`Unknown program kind: ${String(args.kind)}.`);
  }
  if (typeof args.name !== "string" || args.name.trim() === "") {
    throw new Error("Program name must not be blank.");
  }
  const requestedName = args.name.trim();

  const res = await client.request<unknown>("POST", "/1.0/coach/programs/create", {
    body: { finite: args.kind === "fixed", name: requestedName },
  });
  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    throw new Error(`Program create failed (HTTP ${res.status}): ${detail}`);
  }

  checkResponse(programCreateResponseSchema, res.data, "program create");
  const rec = isRecord(res.data) ? res.data : {};
  const nested = isRecord(rec.program) ? rec.program : {};
  const containerId = coerceInt(rec.id);
  const programId =
    coerceInt(rec.programId) ?? coerceInt(rec.group_program) ?? coerceInt(nested.id);
  if (containerId === null || programId === null) {
    throw new Error("Program create response is missing the container id or program id.");
  }
  if (typeof rec.title !== "string" || rec.title.trim() === "") {
    throw new Error("Program create response is missing the assigned title.");
  }
  const title = rec.title;
  return {
    containerId,
    programId,
    title,
    kind: args.kind,
    requestedName,
    nameApplied: title === requestedName,
  };
}

export type DeletedProgram = {
  /** Actual program id sent to `DELETE /v5/programs/{id}`. */
  programId: number;
  /** Container id when the caller passed a list_programs row id (otherwise null). */
  containerId: number | null;
};

/**
 * Delete a standalone program (`DELETE /v5/programs/{programId}`).
 *
 * The live API 401s when the path id is a list_programs container id. Pass either id: this
 * resolves a container to its `group_program` first. Team calendars are not in that list; their
 * program id is deleted as given. This is not idempotent against an unknown failure.
 */
export async function deleteProgram(
  client: TrainHeroicClient,
  programId: number,
): Promise<DeletedProgram> {
  if (!Number.isInteger(programId) || programId <= 0) {
    throw new Error("Program id must be a positive integer.");
  }

  let targetId = programId;
  let containerId: number | null = null;

  const programs = await client.request<unknown>("GET", "/1.0/coach/programs");
  if (programs.ok && Array.isArray(programs.data)) {
    const asContainer = programs.data.find(
      (item) => isRecord(item) && coerceInt(item.id) === programId,
    );
    if (isRecord(asContainer)) {
      const resolved = coerceInt(asContainer.group_program);
      if (resolved !== null) {
        containerId = programId;
        targetId = resolved;
      }
    } else {
      const asProgram = programs.data.find(
        (item) => isRecord(item) && coerceInt(item.group_program) === programId,
      );
      if (isRecord(asProgram)) containerId = coerceInt(asProgram.id);
    }
  }

  const res = await client.request("DELETE", `/v5/programs/${targetId}`, {
    expectedStatuses: [401, 403, 404],
  });
  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    throw new Error(`Program delete failed (HTTP ${res.status}): ${detail}`);
  }
  return { programId: targetId, containerId };
}

/** Normalize one-or-many emails into a deduped, trimmed list. */
function emailList(emails: readonly string[]): string[] {
  return [...new Set(emails.map((e) => e.trim()).filter((e) => e.length > 0))];
}

/** A roster member as id + display name. */
export type CoachRosterAthlete = { id: number; name: string | null };

/** The display name on a /v5/athletes row: `fullName` (e.g. "Cohen, A"), else first+last. */
function rosterName(rec: Record<string, unknown>): string | null {
  const full = typeof rec.fullName === "string" ? rec.fullName.trim() : "";
  if (full !== "") return full;
  const first = typeof rec.firstName === "string" ? rec.firstName : "";
  const last = typeof rec.lastName === "string" ? rec.lastName : "";
  const combined = `${first} ${last}`.trim();
  return combined !== "" ? combined : null;
}

/**
 * The coach's roster as id + display name, from /v5/athletes. One home for the id coercion and the
 * name-field choice (the API uses `fullName` / `firstName`+`lastName`), so the CLI, the MCP tools,
 * and the warehouse store map the roster identically. Includes the account owner and
 * demo/placeholder athletes (the raw roster does); pass `ids` to keep only a subset.
 */
export async function fetchCoachRoster(
  client: TrainHeroicClient,
  ids?: readonly number[],
): Promise<CoachRosterAthlete[]> {
  const res = await client.request<unknown>("GET", "/v5/athletes");
  if (!res.ok || !Array.isArray(res.data)) {
    throw new Error(`List athletes failed (HTTP ${res.status}).`);
  }
  const keep = ids && ids.length > 0 ? new Set(ids) : null;
  const out: CoachRosterAthlete[] = [];
  for (const row of res.data) {
    if (typeof row !== "object" || row === null) continue;
    const rec = row as Record<string, unknown>;
    const id = coerceInt(rec.id);
    if (id === null || id <= 0) continue;
    if (keep && !keep.has(id)) continue;
    out.push({ id, name: rosterName(rec) });
  }
  return out;
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
 * Update a team's title and/or reassign its calendar (`PUT /v5/teams/{teamId}`).
 *
 * The live API accepts `group_program` to point the team at an existing parent program /
 * calendar (e.g. another team's `group_program` from `list_teams`), but rejects a body that
 * has only `group_program` (HTTP 400 "Invalid parameters"). When `title` is omitted we read
 * the current title first so callers can re-link without renaming.
 */
export async function updateTeam(
  client: TrainHeroicClient,
  args: { teamId: number; title?: string; groupProgram?: number },
): Promise<unknown> {
  if (args.title === undefined && args.groupProgram === undefined) {
    throw new Error("Provide title and/or groupProgram.");
  }
  let title = args.title;
  if (title === undefined) {
    const existing = await client.request<unknown>("GET", `/v5/teams/${args.teamId}`);
    if (!existing.ok) {
      const detail =
        typeof existing.data === "string" ? existing.data : JSON.stringify(existing.data);
      throw new Error(`GET /v5/teams/${args.teamId} failed (HTTP ${existing.status}): ${detail}`);
    }
    const rec =
      existing.data && typeof existing.data === "object"
        ? (existing.data as { title?: unknown })
        : null;
    title = typeof rec?.title === "string" ? rec.title : "";
    if (title.trim() === "") {
      throw new Error(
        `Could not read current title for team ${args.teamId}; pass title explicitly.`,
      );
    }
  }
  const body: { title: string; group_program?: number } = { title };
  if (args.groupProgram !== undefined) body.group_program = args.groupProgram;
  const res = await client.request("PUT", `/v5/teams/${args.teamId}`, { body });
  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    throw new Error(`PUT /v5/teams/${args.teamId} failed (HTTP ${res.status}): ${detail}`);
  }
  return res.data;
}

/**
 * Update a team's auto-publish settings (`POST /1.0/coach/team/updatePublishSettings`).
 * The live API 500s on a partial body; it wants the full program object from
 * `GET /3.0/coach/program/{programId}` with `pub_*` fields merged on top.
 */
export async function updateTeamPublishSettings(
  client: TrainHeroicClient,
  args: { programId?: number; teamId?: number; patch: Record<string, unknown> },
): Promise<unknown> {
  if (args.programId !== undefined && args.teamId !== undefined) {
    throw new Error("Pass programId or teamId, not both.");
  }
  if (Object.keys(args.patch).length === 0) {
    throw new Error("Provide at least one pub_* field to change.");
  }
  let programId = args.programId;
  if (programId === undefined) {
    if (args.teamId === undefined || args.teamId <= 0) {
      throw new Error("Provide programId or teamId.");
    }
    const team = await client.request("GET", `/v5/teams/${args.teamId}`);
    if (!team.ok || !isRecord(team.data)) {
      const detail = typeof team.data === "string" ? team.data : JSON.stringify(team.data);
      throw new Error(`GET /v5/teams/${args.teamId} failed (HTTP ${team.status}): ${detail}`);
    }
    const resolved = coerceInt(team.data.group_program) ?? coerceInt(team.data.programId);
    if (resolved === null || resolved <= 0) {
      throw new Error(`Team ${args.teamId} has no group_program.`);
    }
    programId = resolved;
  }
  if (programId <= 0) throw new Error("programId must be positive.");
  const current = await client.request("GET", `/3.0/coach/program/${args.programId}`);
  if (!current.ok || !isRecord(current.data)) {
    const detail = typeof current.data === "string" ? current.data : JSON.stringify(current.data);
    throw new Error(
      `GET /3.0/coach/program/${args.programId} failed (HTTP ${current.status}): ${detail}`,
    );
  }
  const res = await client.request("POST", "/1.0/coach/team/updatePublishSettings", {
    body: { ...current.data, ...args.patch },
  });
  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    throw new Error(`updatePublishSettings failed (HTTP ${res.status}): ${detail}`);
  }
  return res.data;
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
  const path = "/2.0/coach/calendar/copyProgramWorkout";
  const res = await client.request("POST", path, {
    body: {
      toProgramId: args.toProgramId,
      pwId: args.pwId,
      toDate: { date: iso, day, month, year, dayOfWeek, isToday: false },
      // The legacy endpoint requires both mutually exclusive destination fields. The coach UI
      // sends an explicit null for date-based copies; omitting it makes TrainHeroic return 500.
      toTimelineDate: null,
    },
  });
  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    throw calendarWriteError("POST", path, res.status, detail);
  }
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

/** Create a reusable session template in the coach library (`POST /v5/sessions/template`). */
export async function createSessionTemplate(
  client: TrainHeroicClient,
  args: { title: string; instruction?: string },
): Promise<Record<string, unknown>> {
  const title = args.title.trim();
  if (title === "") throw new Error("Session template title must not be blank.");
  const body: Record<string, unknown> = { title };
  if (args.instruction !== undefined) body.instruction = args.instruction;
  const res = await client.request("POST", "/v5/sessions/template", { body });
  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    throw new Error(`Session template create failed (HTTP ${res.status}): ${detail}`);
  }
  if (!isRecord(res.data) || coerceInt(res.data.id) === null) {
    throw new Error("Session template create response is missing an id.");
  }
  return res.data;
}

/** Delete a library session template (`DELETE /v5/sessions/template/{id}`). */
export async function deleteSessionTemplate(
  client: TrainHeroicClient,
  id: number,
): Promise<{ deleted: number }> {
  if (id <= 0) throw new Error("Session template id must be positive.");
  const res = await client.request("DELETE", `/v5/sessions/template/${id}`, {
    expectedStatuses: [401, 403, 404],
  });
  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    throw new Error(`Session template delete failed (HTTP ${res.status}): ${detail}`);
  }
  return { deleted: id };
}
