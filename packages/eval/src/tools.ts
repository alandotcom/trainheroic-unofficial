// The coach MCP surface as the harness sees it: the read/write tool partition and the built-ins to
// deny. These MUST stay in sync with the tools registered in packages/core/src/tools/ — a tool
// missing from both lists is denied in every mode, so the eval silently can't exercise it. When you
// add a core coach tool, add it to the matching list here (and to packages/eval/src/canonical.ts so
// the CLI surface maps to the same capability name).

export const COACH_SERVER = "trainheroic-local-coach";
export const COACH_PREFIX = `mcp__${COACH_SERVER}__`;

/** Read-only coach tools — the surface a read eval is allowed to call. */
export const COACH_READ_TOOLS: readonly string[] = [
  "whoami",
  "head_coach",
  "list_programs",
  "notifications",
  "analytics_categories",
  "list_athletes",
  "list_teams",
  "get_team",
  "list_team_codes",
  "get_program",
  "athlete_lift_history",
  "athlete_training",
  "athlete_saved_workouts",
  "roster_activity",
  "team_volume",
  "analytics_query",
  "exercise_resolve",
  "exercise_search",
  "exercise_get",
  "store_stats",
  "messaging_conversations",
  "messaging_read",
  "message_draft",
];

/** Write/destructive coach tools — denied in a read eval, allowed only in a write eval. */
export const COACH_WRITE_TOOLS: readonly string[] = [
  "message_send",
  "message_delete",
  "athlete_invite",
  "athlete_archive",
  "athlete_restore",
  "team_create",
  "team_update",
  "team_delete",
  "team_code_create",
  "team_code_delete",
  "exercise_create",
  "exercise_forget",
  "exercise_sync",
  "session_copy",
  "session_remove",
  "session_unpublish",
  "session_save_as_template",
  "workout_build",
  "workout_publish",
  "log_athlete_set",
  "coach_log_session",
  "swap_athlete_exercise",
  "prescribe_athlete_set",
];

/**
 * Built-in tools denied in every mode. The allow-list only pre-approves the surface's own tools;
 * the built-ins stay in the model's toolset and would otherwise prompt (and stall a headless run)
 * or let the agent shell out / read source instead of driving the surface under test. (The CLI
 * surface allows `Bash(trainheroic:*)` on top of these denials so the agent can run the CLI.)
 */
export const DENIED_BUILTINS: readonly string[] = [
  "Read",
  "Edit",
  "Write",
  "NotebookEdit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
  "ToolSearch",
  "Skill",
  "SlashCommand",
];

// --- Athlete surface ---

export const ATHLETE_SERVER = "trainheroic-local";
export const ATHLETE_PREFIX = `mcp__${ATHLETE_SERVER}__`;

/** Read-only athlete tools. */
export const ATHLETE_READ_TOOLS: readonly string[] = [
  "athlete_whoami",
  "athlete_profile",
  "athlete_prefs",
  "athlete_working_maxes",
  "athlete_leaderboard",
  "athlete_workouts",
  "athlete_log_targets",
  "athlete_exercises",
  "athlete_exercise_history",
  "athlete_personal_records",
  "athlete_exercise_stats",
];

/** Write athlete tools — denied in a read eval. */
export const ATHLETE_WRITE_TOOLS: readonly string[] = [
  "athlete_session_create",
  "athlete_session_add_exercises",
  "athlete_session_remove",
  "athlete_log_session",
  "athlete_log_set",
];

export type RoleTools = {
  server: string;
  prefix: string;
  /** The MCP server package (under packages/) whose tsx bin + src/server.ts the harness spawns. */
  pkg: string;
  readTools: readonly string[];
  writeTools: readonly string[];
};

export const ROLE_TOOLS: Record<"coach" | "athlete", RoleTools> = {
  coach: {
    server: COACH_SERVER,
    prefix: COACH_PREFIX,
    pkg: "coach-mcp",
    readTools: COACH_READ_TOOLS,
    writeTools: COACH_WRITE_TOOLS,
  },
  athlete: {
    server: ATHLETE_SERVER,
    prefix: ATHLETE_PREFIX,
    pkg: "athlete-mcp",
    readTools: ATHLETE_READ_TOOLS,
    writeTools: ATHLETE_WRITE_TOOLS,
  },
};

export function prefixed(prefix: string, tools: readonly string[]): string[] {
  return tools.map((t) => `${prefix}${t}`);
}
