#!/usr/bin/env bash
# Standalone MCP eval runner.
#
#   scripts/mcp-eval.sh <athlete|coach> "<query>" [YYYY-MM-DD]
#
# Runs ONE realistic user question through the local TrainHeroic MCP using a fresh, headless
# `claude -p` subprocess. That subprocess spawns its OWN stdio server (via .mcp.json), so it
# always loads the CURRENT source — no reconnect, no dependency on the parent session's pinned
# MCP connection. Strictly read-only: only read/query tools are whitelisted; every write tool
# is explicitly denied. Prints the model's answer followed by a delimited ===EVAL REPORT===.
#
# Fan out by calling this once per query (background several for a full bank). It needs the
# `claude` CLI on PATH and the repo .env (coach/athlete creds) that .mcp.json's launcher reads.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROLE="${1:-}"
QUERY="${2:-}"
TODAY="${3:-$(date +%F)}"

if [ -z "$ROLE" ] || [ -z "$QUERY" ]; then
  echo "usage: scripts/mcp-eval.sh <athlete|coach> \"<query>\" [YYYY-MM-DD]" >&2
  exit 2
fi

# One stdio server per role, plus the role's read whitelist and write denylist. The denylist is
# belt-and-suspenders on top of the whitelist so a write can never run even if the list drifts.
case "$ROLE" in
  athlete)
    SERVER="trainheroic-local"
    PREFIX="mcp__trainheroic-local__"
    READS="athlete_whoami athlete_profile athlete_prefs athlete_working_maxes athlete_leaderboard athlete_workouts athlete_exercises athlete_exercise_history athlete_personal_records athlete_exercise_stats"
    WRITES="athlete_log_set athlete_session_create athlete_session_add_exercises"
    ;;
  coach)
    SERVER="trainheroic-local-coach"
    PREFIX="mcp__trainheroic-local-coach__"
    READS="whoami head_coach list_programs notifications analytics_categories list_athletes list_teams get_team list_team_codes get_program athlete_lift_history athlete_training analytics_query exercise_resolve exercise_search exercise_get store_stats messaging_conversations messaging_read message_draft"
    WRITES="message_send message_delete athlete_invite athlete_archive athlete_restore team_create team_update team_delete team_code_create team_code_delete exercise_create exercise_forget exercise_sync session_copy session_remove session_unpublish session_save_as_template workout_build workout_publish"
    ;;
  *)
    echo "mcp-eval: unknown role '$ROLE' (use athlete|coach)" >&2
    exit 2
    ;;
esac

# Build the allow/deny tool argument lists (prefixed, plus Read/Bash for parsing large results).
ALLOWED=("Read" "Bash")
for t in $READS; do ALLOWED+=("${PREFIX}${t}"); done
DENIED=()
for t in $WRITES; do DENIED+=("${PREFIX}${t}"); done

# A single-server MCP config so the headless run spawns only the role's server.
CONFIG="$(mktemp -t mcp-eval-XXXXXX.json)"
trap 'rm -f "$CONFIG"' EXIT
cat >"$CONFIG" <<JSON
{
  "mcpServers": {
    "$SERVER": {
      "command": "bash",
      "args": ["scripts/mcp-eval-server.sh", "$ROLE"]
    }
  }
}
JSON

read -r -d '' PROMPT <<PROMPT_EOF || true
You are role-playing a general AI assistant connected to the TrainHeroic MCP. Its tools are
named ${PREFIX}* . Use whatever TrainHeroic tools you need.

CONTEXT: Today's date is ${TODAY}. Answer as if for the account owner.

HARD CONSTRAINTS — this is an evaluation, stay strictly read-only:
- Never call a tool that writes, logs, creates, modifies, deletes, sends, publishes, archives,
  or confirms anything. Only read/query/list operations are allowed. If answering would require
  a write, do not do it — note that in your report instead.

YOUR TASK: Answer this question as naturally and correctly as you can, grounded in real tool
results. Work like a real assistant — explore, recover from dead ends, do not give up early:
"${QUERY}"

Then output a delimited report for the MCP developer in EXACTLY this format:

===EVAL REPORT===
QUERY: "${QUERY}"
FINAL_ANSWER: <one-paragraph summary of what you concluded for the user>
ANSWER_REACHED: yes | partial | no
TOOL_CALLS (in order, one per line): <n>. <tool_name> | args: <key args> | outcome: <useful / empty / error / wrong-direction>
TOTAL_TOOL_CALLS: <number>
DEAD_ENDS_AND_BACKTRACKS: <each tool call that did not help, wrong tool picked, or reconsideration — and why>
CONFUSION_POINTS: <where tool names/descriptions were ambiguous or misleading>
WHAT_WOULD_HAVE_HELPED: <concrete tool name/description/param changes that would have been faster>
CONFUSION_SCORE: <1=effortless to 5=very confusing>
===END EVAL REPORT===

Be brutally honest in the report — its purpose is to find MCP usability problems.
PROMPT_EOF

cd "$ROOT"
exec claude -p "$PROMPT" \
  --model sonnet \
  --strict-mcp-config \
  --mcp-config "$CONFIG" \
  --permission-mode default \
  --allowed-tools "${ALLOWED[@]}" \
  --disallowed-tools "${DENIED[@]}" \
  --output-format text
