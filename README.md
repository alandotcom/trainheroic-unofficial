# trainheroic-unofficial

[![npm](https://img.shields.io/npm/v/@trainheroic-unofficial/dto?label=dto)](https://www.npmjs.com/package/@trainheroic-unofficial/dto)
[![npm](https://img.shields.io/npm/v/@trainheroic-unofficial/js?label=js)](https://www.npmjs.com/package/@trainheroic-unofficial/js)
[![npm](https://img.shields.io/npm/v/@trainheroic-unofficial/core?label=core)](https://www.npmjs.com/package/@trainheroic-unofficial/core)
[![npm](https://img.shields.io/npm/v/@trainheroic-unofficial/coach-mcp?label=coach-mcp)](https://www.npmjs.com/package/@trainheroic-unofficial/coach-mcp)
[![npm](https://img.shields.io/npm/v/@trainheroic-unofficial/cli?label=cli)](https://www.npmjs.com/package/@trainheroic-unofficial/cli)

TrainHeroic tools for Claude and other MCP clients. Build and publish workouts, manage athletes, teams, and programs, read analytics, and send messages — all from your AI assistant.

---

## MCP

**Hosted** — OAuth login, no install, credentials stored server-side.

URL: `https://trainheroic-mcp.alandotcom.workers.dev/mcp`

Claude Code: `claude mcp add trainheroic --transport http https://trainheroic-mcp.alandotcom.workers.dev/mcp`

claude.ai: [Settings → Connectors → Add custom connector](https://claude.ai/customize/connectors?modal=add-custom-connector)

Claude Desktop:
```jsonc
{ "mcpServers": { "trainheroic": { "command": "npx", "args": ["-y", "mcp-remote", "https://trainheroic-mcp.alandotcom.workers.dev/mcp", "--transport", "http-only"] } } }
```

**Local** — credentials stay in your environment.

Claude Code:
```bash
claude mcp add trainheroic \
  -e TRAINHEROIC_EMAIL=coach@example.com \
  -e TRAINHEROIC_PASSWORD=yourpassword \
  -- npx -y @trainheroic-unofficial/coach-mcp
```

Claude Desktop / `.mcp.json`:
```jsonc
{ "mcpServers": { "trainheroic": { "command": "npx", "args": ["-y", "@trainheroic-unofficial/coach-mcp"], "env": { "TRAINHEROIC_EMAIL": "...", "TRAINHEROIC_PASSWORD": "..." } } } }
```

---

## Skill + CLI

```bash
npm install -g @trainheroic-unofficial/cli
export TRAINHEROIC_EMAIL=coach@example.com TRAINHEROIC_PASSWORD=yourpassword
trainheroic install-skill   # or: bunx skills add alandotcom/trainheroic-unofficial
```

Type `/trainheroic-unofficial` in a Claude Code session to activate.

---

## Tools

**Coach reads:** `whoami`, `head_coach`, `list_athletes`, `list_teams`, `get_team`, `list_team_codes`, `list_programs`, `get_program`, `notifications`, `analytics_categories`

**Exercises:** `exercise_resolve`, `exercise_search`, `exercise_get`, `exercise_sync`, `exercise_create`, `exercise_forget`, `store_stats`

**Workouts:** `workout_build`, `workout_read`, `workout_publish`†, `session_remove`†

**Messaging:** `messaging_conversations`, `messaging_read`, `message_draft`, `message_send`†, `message_delete`†

**Escape hatch:** `th_request` — any TrainHeroic endpoint; GET is ungated, POST/PUT/DELETE require confirmation†

**History warehouse** (hosted only): `programming_sync`, `programming_stored`, `messaging_sync`, `messaging_stored`

† Requires explicit confirmation before executing.

---

## Disclaimer

Unofficial, not affiliated with or endorsed by TrainHeroic. Use against your own account at your own risk. The TrainHeroic API is undocumented and may change.
