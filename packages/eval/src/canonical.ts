// Canonical normalization for the CLI surface. The agent drives the CLI by running
// `trainheroic …` Bash commands; to grade CLI and MCP runs with the SAME predicates, each command
// is mapped to the same capability name an MCP tool would have (e.g. `coach teams` → "list_teams",
// `coach athlete-workouts` → "athlete_saved_workouts") and its flags to the same arg names
// (`--program` → programId, `--limit` → limit, …). A non-`trainheroic` command normalizes to null
// (ignored). Keep this table in sync with the CLI commands in packages/cli and the MCP tool names.

/** CLI command path (tokens after `trainheroic`) → canonical capability name. */
const COMMAND_MAP: Record<string, string> = {
  whoami: "whoami",
  "coach head-coach": "head_coach",
  "coach athletes": "list_athletes",
  "coach programs": "list_programs",
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
};

/** Commands whose first positional token after the command path is an id. */
const POSITIONAL_ID: Record<string, string> = {
  "coach program": "programId",
  "coach team": "teamId",
  "coach team-codes": "teamId",
};

/** CLI flag → canonical arg name (only the ones graders inspect need mapping). */
const FLAG_MAP: Record<string, string> = {
  program: "programId",
  team: "teamId",
  athlete: "athleteId",
  limit: "limit",
  q: "q",
  start: "startDate",
  end: "endDate",
  page: "page",
  "page-size": "pageSize",
  summary: "summary",
  "logged-only": "loggedOnly",
  raw: "raw",
};

const BOOLEAN_FLAGS = new Set(["summary", "logged-only", "raw", "log-ids"]);

function tokenize(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Match the longest known command path (3, 2, then 1 token) against the token stream. */
function matchCommand(tokens: string[]): { name: string; pathLen: number; pathKey: string } | null {
  for (let n = Math.min(3, tokens.length); n >= 1; n -= 1) {
    const key = tokens.slice(0, n).join(" ");
    const name = COMMAND_MAP[key];
    if (name !== undefined) return { name, pathLen: n, pathKey: key };
  }
  return null;
}

function parseArgs(rest: string[], pathKey: string): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const positional = POSITIONAL_ID[pathKey];
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

/** Normalize a CLI Bash command to a canonical capability call, or null if it isn't a tool call. */
export function normalizeCliCommand(
  command: string,
): { name: string; input: Record<string, unknown> } | null {
  const tokens = tokenize(command);
  if (tokens.length === 0) return null;
  // The command runs the `trainheroic` shim; tolerate an absolute path to it.
  const first = tokens[0] ?? "";
  if (!/(^|\/)trainheroic$/.test(first)) return null;
  const rest = tokens.slice(1);
  const matched = matchCommand(rest);
  if (matched === null) return null;
  const input = parseArgs(rest.slice(matched.pathLen), matched.pathKey);
  return { name: matched.name, input };
}
