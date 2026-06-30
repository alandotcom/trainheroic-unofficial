export interface ToolGroup {
  title: string;
  tools: string[];
  hostedOnly?: boolean;
}

export const coachTools: ToolGroup[] = [
  {
    title: "Reads",
    tools: [
      "whoami",
      "head_coach",
      "list_programs",
      "notifications",
      "analytics_categories",
      "list_athletes",
      "list_teams",
      "get_team",
      "list_team_codes",
      "athlete_lift_history",
      "roster_activity",
      "athlete_training",
      "get_program",
      "team_volume",
    ],
  },
  {
    title: "Main lifts",
    tools: ["athlete_main_lift_prs", "roster_main_lift_prs"],
  },
  {
    title: "Roster athletes",
    tools: [
      "athlete_invite",
      "athlete_archive",
      "athlete_restore",
      "athlete_saved_workouts",
      "log_athlete_set",
      "coach_log_session",
      "swap_athlete_exercise",
      "prescribe_athlete_set",
    ],
  },
  {
    title: "Teams",
    tools: [
      "team_create",
      "team_update",
      "team_delete",
      "team_code_create",
      "team_code_delete",
    ],
  },
  {
    title: "Analytics",
    tools: ["analytics_query"],
  },
  {
    title: "Exercise library",
    tools: [
      "exercise_resolve",
      "exercise_search",
      "exercise_get",
      "exercise_sync",
      "exercise_create",
      "exercise_forget",
      "store_stats",
    ],
  },
  {
    title: "Workouts",
    tools: [
      "workout_build",
      "workout_read",
      "workout_publish",
      "session_remove",
      "session_unpublish",
      "session_copy",
      "session_save_as_template",
    ],
  },
  {
    title: "Messaging",
    tools: [
      "messaging_conversations",
      "messaging_read",
      "message_draft",
      "message_send",
      "message_delete",
    ],
  },
];

export const athleteTools: ToolGroup[] = [
  {
    title: "Profile",
    tools: [
      "athlete_whoami",
      "athlete_profile",
      "athlete_prefs",
      "athlete_working_maxes",
      "athlete_leaderboard",
    ],
  },
  {
    title: "History",
    tools: [
      "athlete_workouts",
      "athlete_exercises",
      "athlete_exercise_history",
      "athlete_personal_records",
      "athlete_exercise_stats",
      "athlete_log_targets",
    ],
  },
  {
    title: "Session logging",
    tools: [
      "athlete_session_create",
      "athlete_session_add_exercises",
      "athlete_session_remove",
      "athlete_log_session",
      "athlete_log_set",
    ],
  },
];

export const hostedOnlyTools: ToolGroup[] = [
  {
    title: "Coach warehouse",
    tools: ["programming_sync", "programming_stored", "messaging_sync", "messaging_stored"],
    hostedOnly: true,
  },
  {
    title: "Athlete warehouse",
    tools: [
      "athlete_workouts_sync",
      "athlete_workouts_stored",
      "athlete_training_sync",
      "athlete_training_stored",
    ],
    hostedOnly: true,
  },
  {
    title: "Feedback",
    tools: ["report_feedback"],
    hostedOnly: true,
  },
];

export const MCP_URL = "https://mcp.trainheroic-unofficial.com/mcp";
export const MCP_COACH_URL = "https://mcp.trainheroic-unofficial.com/mcp/coach";
export const MCP_ATHLETE_URL = "https://mcp.trainheroic-unofficial.com/mcp/athlete";

export const NPM_JS = "@trainheroic-unofficial/js";
export const NPM_DTO = "@trainheroic-unofficial/dto";
export const NPM_COACH_MCP = "@trainheroic-unofficial/coach-mcp";
export const NPM_ATHLETE_MCP = "@trainheroic-unofficial/athlete-mcp";
