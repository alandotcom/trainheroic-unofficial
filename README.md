# trainheroic-unofficial

TrainHeroic tools for Claude and other MCP clients. Build and publish workouts, manage athletes, teams, and programs, read analytics, and send messages — all from your AI assistant.

Two ways to connect: a **hosted server** (no install, OAuth login) and a **local server** (runs on your machine, credentials in env).

---

## Hosted MCP

Connect to the shared hosted server. No install required. You sign in with your TrainHeroic credentials through a browser; they are stored encrypted server-side and never leave the server.

**URL:** `https://trainheroic-mcp.alandotcom.workers.dev/mcp`

**claude.ai** — add it in Settings → Integrations → Add integration, paste the URL above.

**Claude Code:**
```bash
claude mcp add trainheroic --transport http https://trainheroic-mcp.alandotcom.workers.dev/mcp
```

**Claude Desktop** (`claude_desktop_config.json`):
```jsonc
{
  "mcpServers": {
    "trainheroic": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://trainheroic-mcp.alandotcom.workers.dev/mcp",
        "--transport", "http-only"
      ]
    }
  }
}
```

**OpenAI Codex** and other clients that accept an SSE/HTTP MCP URL: paste the URL directly.

---

## Local MCP

Runs on your machine. Credentials stay in your environment; nothing is sent to a third-party server.

### Claude Desktop extension (easiest)

Download `trainheroic-coach-mcp.mcpb` from the [Releases page](https://github.com/alandotcom/trainheroic-skill/releases), drag it onto Claude Desktop, and enter your TrainHeroic email and password. Credentials are stored in the OS keychain.

### Claude Code

```bash
claude mcp add trainheroic \
  -e TRAINHEROIC_EMAIL=coach@example.com \
  -e TRAINHEROIC_PASSWORD=yourpassword \
  -- npx -y @trainheroic-unofficial/coach-mcp
```

### Claude Desktop / `.mcp.json` / other stdio clients

```jsonc
{
  "mcpServers": {
    "trainheroic": {
      "command": "npx",
      "args": ["-y", "@trainheroic-unofficial/coach-mcp"],
      "env": {
        "TRAINHEROIC_EMAIL": "coach@example.com",
        "TRAINHEROIC_PASSWORD": "yourpassword"
      }
    }
  }
}
```

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
