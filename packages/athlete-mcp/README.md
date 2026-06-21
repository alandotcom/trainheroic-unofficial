# @trainheroic-unofficial/athlete-mcp

Local single-user [MCP](https://modelcontextprotocol.io) server for a TrainHeroic **athlete** — it exposes one [TrainHeroic](https://www.trainheroic.com) athlete's own training to an AI assistant (Claude Code, Claude Desktop, or any MCP client) as callable tools. It runs on your machine and speaks the MCP stdio transport, so the assistant launches it as a subprocess.

It reads two required environment variables, `TRAINHEROIC_EMAIL` and `TRAINHEROIC_PASSWORD` — your existing TrainHeroic login. These are your real credentials in plaintext; the config below puts them in a file or shell history, so treat them as secrets.

It exposes the logged-in athlete's own training — scheduled and completed workouts, per-exercise history, PRs (personal records), working maxes, and lifetime totals — plus one confirmation-gated write that logs a completed set. For coaching (rosters, teams, programs, messaging), use [`@trainheroic-unofficial/coach-mcp`](../coach-mcp). For a hosted version that holds credentials server-side behind OAuth and gives a coach login both the athlete and coaching tools, see the [root README](../../README.md).

---

## Install

Needs Node (>= 18); the commands below fetch the package with `npx` on first run.

### Claude Code

```bash
claude mcp add trainheroic-athlete \
  -e TRAINHEROIC_EMAIL=athlete@example.com \
  -e TRAINHEROIC_PASSWORD=yourpassword \
  -- npx -y @trainheroic-unofficial/athlete-mcp
```

### Claude Desktop / `.mcp.json` / other stdio clients

Put this in your client's MCP config — for Claude Desktop that's `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`; Windows: `%APPDATA%\Claude\`); for a
project-scoped Claude Code setup it's `.mcp.json` at the repo root.

```json
{
  "mcpServers": {
    "trainheroic-athlete": {
      "command": "npx",
      "args": ["-y", "@trainheroic-unofficial/athlete-mcp"],
      "env": {
        "TRAINHEROIC_EMAIL": "athlete@example.com",
        "TRAINHEROIC_PASSWORD": "yourpassword"
      }
    }
  }
}
```

A coach account works here too: a TrainHeroic coach account also has its own athlete-side data, so it can read its own training through these tools. After it connects, ask the assistant something like "show my recent workouts" to confirm the tools are available.

---

## Tools

All read-only except `athlete_log_set`. The assistant fills in each tool's parameters (dates
are `YYYY-MM-DD`); your MCP client shows the full schema for each.

- `athlete_whoami` — identity (id, name, roles)
- `athlete_profile` — lifetime totals + profile
- `athlete_prefs` — notification/display preferences
- `athlete_workouts` — scheduled + completed workouts in a date range, flattened into one list
- `athlete_exercises` — search the exercises you've logged
- `athlete_exercise_history` — per-exercise PRs + dated session history
- `athlete_personal_records` — exercise personal records
- `athlete_exercise_stats` — last performance + PR as of a date
- `athlete_working_maxes` — working max per exercise
- `athlete_leaderboard` — benchmark/test workout leaderboard

**Write (confirmation-gated):**

- `athlete_log_set` — logs completed set results to your training log. This is a real write
  that your coach can see. It confirms before running: the server asks the client to confirm,
  falling back to an explicit `confirm: true` argument when the client can't prompt.

---

## Develop

Run `pnpm install` once at the repo root (Node >= 22, pnpm 10), then from this package. The
`pnpm start`/`pnpm inspect` commands need `TRAINHEROIC_EMAIL` and `TRAINHEROIC_PASSWORD`
exported in your shell. "MCP Inspector" is the [official MCP debugging UI](https://github.com/modelcontextprotocol/inspector).

```bash
pnpm start       # run from source
pnpm inspect     # MCP Inspector UI against the source server
pnpm build       # tsdown → dist/server.mjs
pnpm typecheck
pnpm test
```
