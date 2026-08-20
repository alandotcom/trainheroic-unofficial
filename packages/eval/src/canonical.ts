// Canonical normalization for the CLI surface. The agent drives the CLI by running `trainheroic …`
// Bash commands; to grade CLI and MCP runs with the SAME predicates, each command is mapped to the
// same capability name an MCP tool would have, and its flags to the same arg names. The map is
// per-role (coach vs athlete) since the command groups differ. A non-`trainheroic` command, or one
// not in the role's map, normalizes to null (ignored). Keep these maps in sync with the CLI commands
// in packages/cli and the MCP tool names.

import type { Role } from "./types";

/** coach CLI command path (tokens after `trainheroic`) → canonical capability name. */
export const COACH_COMMANDS: Record<string, string> = {
  whoami: "whoami",
  "coach head-coach": "head_coach",
  "coach athletes": "list_athletes",
  "coach programs": "list_programs",
  "coach program-create": "program_create",
  "coach program-delete": "program_delete",
  "coach session-templates": "list_session_templates",
  "coach session-template-create": "session_template_create",
  "coach session-template-delete": "session_template_delete",
  "coach notifications-list": "list_notifications",
  "coach subscriptions": "list_subscriptions",
  "coach prescription-templates": "list_prescription_templates",
  "coach athlete-team-calendar": "coach_athlete_team_calendar",
  "coach team-publish-settings": "team_publish_settings",
  "coach teams": "list_teams",
  "coach program": "get_program",
  "coach team": "get_team",
  "coach team-codes": "list_team_codes",
  "coach roster-activity": "roster_activity",
  "coach team-volume": "team_volume",
  "coach athlete-training": "athlete_training",
  "coach athlete-lift-history": "athlete_lift_history",
  "coach athlete-workouts": "athlete_saved_workouts",
  "coach notifications": "notifications",
  "coach analytics-query": "analytics_query",
  "coach analytics": "analytics_categories",
  "coach log-set": "log_athlete_set",
  "coach log-session": "coach_log_session",
  "coach prescribe-set": "prescribe_athlete_set",
  "coach swap-exercise": "swap_athlete_exercise",
  "coach exercise resolve": "exercise_resolve",
  "coach exercise search": "exercise_search",
  "coach exercise get": "exercise_get",
  "coach exercise create": "exercise_create",
  "coach exercise update": "exercise_update",
  "coach exercise delete": "exercise_delete",
};

/** athlete CLI command path → canonical capability name. */
export const ATHLETE_COMMANDS: Record<string, string> = {
  "athlete whoami": "athlete_whoami",
  "athlete profile": "athlete_profile",
  "athlete prefs": "athlete_prefs",
  "athlete working-maxes": "athlete_working_maxes",
  "athlete workouts": "athlete_workouts",
  "athlete exercises": "athlete_exercises",
  "athlete recent-exercises": "athlete_recent_exercises",
  "athlete circuits": "athlete_circuits",
  "athlete programs": "athlete_programming_programs",
  "athlete history": "athlete_exercise_history",
  "athlete prs": "athlete_personal_records",
  "athlete stats": "athlete_exercise_stats",
  "athlete leaderboard": "athlete_leaderboard",
  "athlete log-targets": "athlete_log_targets",
  "athlete log-set": "athlete_log_set",
  "athlete prescribe-set": "athlete_prescribe_set",
  "athlete log-session": "athlete_log_session",
  "athlete session-remove": "athlete_session_remove",
  "athlete swap-exercise": "athlete_swap_exercise",
};

/** Commands whose first positional token after the command path is an id, keyed by canonical name. */
const POSITIONAL_ID: Record<string, string> = {
  get_program: "programId",
  get_team: "teamId",
  list_team_codes: "teamId",
  athlete_exercise_history: "exerciseId",
  athlete_personal_records: "exerciseId",
  athlete_exercise_stats: "exerciseId",
  athlete_leaderboard: "workoutId",
  exercise_delete: "id",
  session_template_delete: "id",
};

/** CLI flag → canonical arg name (only the ones graders inspect need mapping). */
const FLAG_MAP: Record<string, string> = {
  program: "program",
  kind: "kind",
  name: "name",
  "program-id": "programId",
  team: "teamId",
  athlete: "athleteId",
  limit: "limit",
  q: "q",
  start: "startDate",
  end: "endDate",
  date: "date",
  page: "page",
  "page-size": "pageSize",
  summary: "summary",
  "logged-only": "loggedOnly",
  raw: "raw",
};

const BOOLEAN_FLAGS = new Set(["summary", "logged-only", "raw", "log-ids", "metric"]);

function tokenize(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Match the longest known command path (3, 2, then 1 token) against the token stream. */
function matchCommand(
  tokens: string[],
  map: Record<string, string>,
): { name: string; pathLen: number } | null {
  for (let n = Math.min(3, tokens.length); n >= 1; n -= 1) {
    const key = tokens.slice(0, n).join(" ");
    const name = map[key];
    if (name !== undefined) return { name, pathLen: n };
  }
  return null;
}

function parseArgs(rest: string[], canonName: string): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const positional = POSITIONAL_ID[canonName];
  for (let i = 0; i < rest.length; i += 1) {
    const tok = rest[i] ?? "";
    if (tok.startsWith("--")) {
      const flag = tok.slice(2);
      const canon = FLAG_MAP[flag];
      if (BOOLEAN_FLAGS.has(flag)) {
        if (canon !== undefined) input[canon] = true;
        continue;
      }
      const next = rest[i + 1];
      const value = next !== undefined && !next.startsWith("--") ? ((i += 1), next) : "";
      if (canon !== undefined) input[canon] = value;
    } else if (positional !== undefined && input[positional] === undefined) {
      input[positional] = tok;
    }
  }
  return input;
}

/** Normalize a CLI Bash command to a canonical capability call for the given role, or null. */
export function normalizeCliCommand(
  command: string,
  role: Role,
): { name: string; input: Record<string, unknown> } | null {
  const tokens = tokenize(command);
  if (tokens.length === 0) return null;
  // The command runs the `trainheroic` shim; tolerate an absolute path to it.
  const first = tokens[0] ?? "";
  if (!/(^|\/)trainheroic$/.test(first)) return null;
  const rest = tokens.slice(1);
  const map = role === "coach" ? COACH_COMMANDS : ATHLETE_COMMANDS;
  const matched = matchCommand(rest, map);
  if (matched === null) return null;
  return { name: matched.name, input: parseArgs(rest.slice(matched.pathLen), matched.name) };
}
