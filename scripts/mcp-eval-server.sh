#!/usr/bin/env bash
# Launch a local TrainHeroic stdio MCP server for the mcp-eval skill.
#
#   mcp-eval-server.sh [athlete|coach]   (default: athlete)
#
# Registered from .mcp.json as the "trainheroic-local" server. stdout carries the MCP
# JSON-RPC stream, so this must never print to stdout — it execs the server with `pnpm exec`
# (no lifecycle banner) rather than `pnpm run` (which would corrupt the stream).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
TARGET="${1:-athlete}"

# Load the repo .env if present (gitignored). Diagnostics go to stderr only.
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

# The athlete server reads TRAINHEROIC_EMAIL/PASSWORD. When athlete-specific creds exist,
# prefer them for the athlete target so the eval runs against the athlete account rather than
# a coach account that happens to fill the generic vars.
if [ "$TARGET" = "athlete" ] && [ -n "${TRAINHEROIC_ATHLETE_EMAIL:-}" ]; then
  export TRAINHEROIC_EMAIL="$TRAINHEROIC_ATHLETE_EMAIL"
  export TRAINHEROIC_PASSWORD="${TRAINHEROIC_ATHLETE_PASSWORD:-}"
fi

if [ -z "${TRAINHEROIC_EMAIL:-}" ] || [ -z "${TRAINHEROIC_PASSWORD:-}" ]; then
  echo "mcp-eval-server: set TRAINHEROIC_EMAIL/PASSWORD (or *_ATHLETE_*) in env or .env" >&2
  exit 1
fi

case "$TARGET" in
  athlete)
    cd "$ROOT/packages/athlete-mcp"
    exec pnpm exec tsx src/server.ts
    ;;
  coach)
    cd "$ROOT/packages/coach-mcp"
    exec pnpm exec tsx src/server.ts
    ;;
  *)
    echo "mcp-eval-server: unknown target '$TARGET' (use athlete|coach)" >&2
    exit 1
    ;;
esac
