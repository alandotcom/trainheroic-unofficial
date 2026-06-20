# @trainheroic-unofficial/athlete-mcp

Local single-user MCP server for a TrainHeroic **athlete**. Runs on your machine over stdio; credentials come from the environment.

It exposes the logged-in athlete's own training — scheduled and completed workouts, per-exercise history, PRs, working maxes, and lifetime totals — plus a confirmation-gated workout-logging write. For coaching (rosters, teams, programs, messaging), use [`@trainheroic-unofficial/coach-mcp`](../coach-mcp). For the hosted version (no install, OAuth login, both surfaces), see the [root README](../../README.md).

---

## Install

### Claude Code

```bash
claude mcp add trainheroic-athlete \
  -e TRAINHEROIC_EMAIL=athlete@example.com \
  -e TRAINHEROIC_PASSWORD=yourpassword \
  -- npx -y @trainheroic-unofficial/athlete-mcp
```

### Claude Desktop / `.mcp.json` / other stdio clients

```jsonc
{
  "mcpServers": {
    "trainheroic-athlete": {
      "command": "npx",
      "args": ["-y", "@trainheroic-unofficial/athlete-mcp"],
      "env": {
        "TRAINHEROIC_EMAIL": "athlete@example.com",
        "TRAINHEROIC_PASSWORD": "yourpassword",
      },
    },
  },
}
```

A coach account works here too: a coach login also carries athlete scope, so it can read its own training through these tools.

---

## Tools

- `athlete_whoami` — identity (id, name, roles)
- `athlete_profile` — lifetime totals + profile
- `athlete_prefs` — notification/display preferences
- `athlete_workouts` — scheduled + completed workouts in a date range (flattened)
- `athlete_exercises` — search the exercises you've logged
- `athlete_exercise_history` — per-exercise PRs + dated session history
- `athlete_personal_records` — exercise personal records
- `athlete_exercise_stats` — last performance + PR as of a date
- `athlete_working_maxes` — working max per exercise
- `athlete_leaderboard` — benchmark/test workout leaderboard
- `athlete_log_set` — gated: log completed set results to your (coach-visible) training log

---

## Develop

```bash
pnpm start       # run from source (needs TRAINHEROIC_EMAIL and TRAINHEROIC_PASSWORD)
pnpm inspect     # MCP Inspector UI against the source server
pnpm build       # tsdown → dist/server.mjs
pnpm typecheck
pnpm test
```
