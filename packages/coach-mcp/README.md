# @trainheroic-unofficial/coach-mcp

Local single-user [MCP](https://modelcontextprotocol.io) server for a TrainHeroic coach — it exposes a [TrainHeroic](https://www.trainheroic.com) coaching account to an AI assistant (Claude Code, Claude Desktop, or any MCP client) as a set of callable tools. It runs on your machine and speaks the MCP stdio transport, so the assistant launches it as a subprocess.

It reads two environment variables, both required:

- `TRAINHEROIC_EMAIL` and `TRAINHEROIC_PASSWORD` — your existing TrainHeroic login.

These are your real credentials in plaintext; the config examples below put them in a file or in shell history, so treat them as secrets. For a version that holds credentials server-side behind OAuth, use the hosted server in the [root README](../../README.md).

---

## Install

Needs Node (>= 18); the commands below fetch the package with `npx` on first run. The server
caches the exercise library as a JSON file under `~/.trainheroic/`.

### Claude Code

```bash
claude mcp add trainheroic \
  -e TRAINHEROIC_EMAIL=coach@example.com \
  -e TRAINHEROIC_PASSWORD=yourpassword \
  -- npx -y @trainheroic-unofficial/coach-mcp
```

### Claude Desktop / `.mcp.json` / other stdio clients

Put this in your client's MCP config — for Claude Desktop that's `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`; Windows: `%APPDATA%\Claude\`); for a
project-scoped Claude Code setup it's `.mcp.json` at the repo root.

```json
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

After it connects, ask the assistant something like "list my athletes" to confirm the tools are available.

---

## Tools

The full coaching surface, grouped by area:

- **Reads** — profile, athletes, teams, programs, notifications, analytics catalog
- **Athletes** — invite, archive, restore
- **Teams** — create, rename, delete, manage join codes
- **Analytics** — readiness, 1RM and working-max history, training summary, compliance, lift progress
- **Exercise library** — resolve, search, get, sync, create, forget, stats
- **Workouts** — build a draft, read it back, publish, unpublish, copy, save as template, remove
- **Messaging** — list streams, read, draft, send, delete

A TrainHeroic coach account also has its own athlete-side data, so the athlete training tools (history, workouts, PRs, working maxes) are available here too. Destructive or athlete-facing actions (publish, remove, send, delete, archive) confirm before they run: the server asks the client to confirm, falling back to an explicit `confirm: true` tool argument when the client can't prompt.

The individual tool names the assistant calls are snake_case (e.g. `list_athletes`, `exercise_resolve`, `workout_publish`); their parameters are described in each tool's schema, which your MCP client surfaces.

---

## Develop

Run `pnpm install` once at the repo root (Node >= 24, pnpm 11), then from this package. The `pnpm start`/`pnpm inspect` commands need `TRAINHEROIC_EMAIL` and `TRAINHEROIC_PASSWORD` exported in your shell. "MCP Inspector" is the [official MCP debugging UI](https://github.com/modelcontextprotocol/inspector).

```bash
pnpm start       # run from source
pnpm inspect     # MCP Inspector UI against the source server
pnpm build       # tsdown → dist/server.mjs
pnpm typecheck
pnpm test
```
