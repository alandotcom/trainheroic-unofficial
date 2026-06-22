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
];

export function prefixed(tools: readonly string[]): string[] {
  return tools.map((t) => `${COACH_PREFIX}${t}`);
}
