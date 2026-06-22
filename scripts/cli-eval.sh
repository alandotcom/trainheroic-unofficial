#!/usr/bin/env bash
# Standalone CLI eval runner — the cli-eval twin of scripts/mcp-eval.sh.
#
#   scripts/cli-eval.sh <athlete|coach> "<query>" [YYYY-MM-DD] [model]
#
# Runs ONE realistic user question through the `trainheroic` CLI using a fresh, headless
# `claude -p` subprocess. The subagent reaches the answer by running CLI subcommands via Bash
# (it is restricted to `Bash(trainheroic:*)` so it cannot sidestep the harness). The CLI runs
# from CURRENT source (pnpm exec tsx), so in-session edits are live. Prints the model's answer
# followed by a delimited ===EVAL REPORT===.
#
# The model defaults to sonnet; pass a 4th arg (or set MODEL=) to eval a different one, e.g.
# `scripts/cli-eval.sh coach "Who's on my roster?" "" haiku`.
#
# Read-only by default, enforced structurally: a `trainheroic` shim on PATH refuses `--yes`, and
# every CLI write requires `--yes` — so all writes fail closed, including ones added later, with
# no command list to maintain. Set WRITES=1 to let `--yes` through and ALSO eval the write
# commands — ONLY against a TEST account, because the destructive commands really fire:
# `WRITES=1 scripts/cli-eval.sh coach "Log 5x5 at 185 for athlete 12345 today" "" haiku`.
#
# Fan out by calling this once per query (background several for a full bank). Needs the `claude`
# CLI on PATH, pnpm, and the repo .env (coach/athlete creds).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROLE="${1:-}"
QUERY="${2:-}"
TODAY="${3:-$(date +%F)}"
MODEL="${4:-${MODEL:-sonnet}}"

if [ -z "$ROLE" ] || [ -z "$QUERY" ]; then
  echo "usage: scripts/cli-eval.sh <athlete|coach> \"<query>\" [YYYY-MM-DD] [model]" >&2
  exit 2
fi
case "$ROLE" in
  athlete | coach) ;;
  *)
    echo "cli-eval: unknown role '$ROLE' (use athlete|coach)" >&2
    exit 2
    ;;
esac

# Write mode toggle (WRITES=1, TEST accounts only). Default read-only.
if [ -n "${WRITES_ENABLED:-${WRITES:-}}" ] && [ "${WRITES_ENABLED:-${WRITES:-}}" != "0" ]; then
  WRITE_MODE=1
else
  WRITE_MODE=0
fi

# Load repo .env (gitignored) so the CLI sees credentials. Diagnostics to stderr only.
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi
# Prefer athlete-specific creds for the athlete role, matching scripts/mcp-eval-server.sh.
if [ "$ROLE" = "athlete" ] && [ -n "${TRAINHEROIC_ATHLETE_EMAIL:-}" ]; then
  export TRAINHEROIC_EMAIL="$TRAINHEROIC_ATHLETE_EMAIL"
  export TRAINHEROIC_PASSWORD="${TRAINHEROIC_ATHLETE_PASSWORD:-}"
fi
if [ -z "${TRAINHEROIC_EMAIL:-}" ] || [ -z "${TRAINHEROIC_PASSWORD:-}" ]; then
  echo "cli-eval: set TRAINHEROIC_EMAIL/PASSWORD (or *_ATHLETE_*) in env or .env" >&2
  exit 1
fi

# Per-run scratch: an isolated session + library cache (so concurrent fan-out runs never clobber
# each other or pollute ~/.trainheroic), plus a bin dir holding the `trainheroic` shim and an
# empty MCP config so the headless run loads NO MCP servers (this eval is the CLI surface only).
WORK="$(mktemp -d -t cli-eval-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
export TRAINHEROIC_SESSION_FILE="$WORK/session.json"
export TRAINHEROIC_CACHE_FILE="$WORK/library.json"
echo '{ "mcpServers": {} }' >"$WORK/mcp.json"

# The shim the subagent invokes as `trainheroic`. It runs the CLI from source; in read-only mode
# it refuses --yes (which neuters every write, present or future, since writes require it).
SHIM="$WORK/trainheroic"
cat >"$SHIM" <<SHIM_EOF
#!/usr/bin/env bash
set -euo pipefail
if [ "$WRITE_MODE" = "0" ]; then
  for a in "\$@"; do
    if [ "\$a" = "--yes" ] || [ "\$a" = "-y" ]; then
      echo "cli-eval: read-only mode — every write needs --yes, so '\$a' is blocked. If the task genuinely needs a write, stop and report it as a gap." >&2
      exit 64
    fi
  done
fi
cd "$ROOT/packages/cli"
exec pnpm exec tsx src/cli.ts "\$@"
SHIM_EOF
chmod +x "$SHIM"
export PATH="$WORK:$PATH"

if [ "$WRITE_MODE" = "1" ]; then
  CONSTRAINTS="MODE — write eval against a TEST account: you MAY run write commands (log-set,
workout build/publish, message send, team/exercise create, etc.) to actually carry out the task.
The account is disposable, so perform the action for real rather than describing it. Writes need
the --yes flag — pass it. Where a command has an inverse (workout publish -> session-unpublish,
create -> delete/forget, archive -> athlete-restore), prefer to reverse your own test writes once
you've confirmed they worked, but completing the task matters more than cleanup. Do NOT modify
data you did not create unless the task requires editing it."
else
  CONSTRAINTS="HARD CONSTRAINTS — this is a read-only evaluation:
- Use only read commands. Never run a command that writes, logs, creates, modifies, deletes,
  sends, publishes, archives, or restores. Those all require --yes and the CLI is wrapped to
  refuse --yes here. If the task genuinely needs a write, do not attempt it — note it as a gap
  in your report."
fi

read -r -d '' PROMPT <<PROMPT_EOF || true
You are role-playing a general AI assistant whose ONLY tool for TrainHeroic is the \`trainheroic\`
command-line program (run it via Bash). It is already authenticated for the account owner's
${ROLE} account — do not set credentials. Discover what it can do the way an agent would: run
\`trainheroic\` with no arguments for the full command reference, and \`trainheroic skill\` for the
workflow guide. Output is JSON on stdout.

CONTEXT: Today's date is ${TODAY}. Answer as if for the account owner.

${CONSTRAINTS}

YOUR TASK: Answer/do this as naturally and correctly as you can, grounded in real command
output. Work like a real assistant — explore the help, recover from dead ends, do not give up
early:
"${QUERY}"

Then output a delimited report for the CLI developer in EXACTLY this format:

===EVAL REPORT===
QUERY: "${QUERY}"
FINAL_ANSWER: <one-paragraph summary of what you concluded for / did for the user>
ANSWER_REACHED: yes | partial | no
COMMANDS (in order, one per line): <n>. trainheroic <subcommand> <key args> | outcome: <useful / empty / error / wrong-direction>
TOTAL_COMMANDS: <number>
DEAD_ENDS_AND_BACKTRACKS: <each command that did not help, wrong command picked, or reconsideration — and why>
CONFUSION_POINTS: <where command names/flags/help text/JSON output were ambiguous or misleading>
WHAT_WOULD_HAVE_HELPED: <concrete command/flag/help/output changes that would have been faster>
CONFUSION_SCORE: <1=effortless to 5=very confusing>
===END EVAL REPORT===

Be brutally honest in the report — its purpose is to find CLI usability problems.
PROMPT_EOF

exec claude -p "$PROMPT" \
  --model "$MODEL" \
  --strict-mcp-config \
  --mcp-config "$WORK/mcp.json" \
  --permission-mode default \
  --allowed-tools "Bash(trainheroic:*)" \
  --output-format text
