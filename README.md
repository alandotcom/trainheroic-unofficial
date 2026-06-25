# trainheroic-unofficial

[![dto](https://img.shields.io/npm/v/@trainheroic-unofficial/dto?label=dto)](https://www.npmjs.com/package/@trainheroic-unofficial/dto)
[![js](https://img.shields.io/npm/v/@trainheroic-unofficial/js?label=js)](https://www.npmjs.com/package/@trainheroic-unofficial/js)
[![core](https://img.shields.io/npm/v/@trainheroic-unofficial/core?label=core)](https://www.npmjs.com/package/@trainheroic-unofficial/core)
[![coach-mcp](https://img.shields.io/npm/v/@trainheroic-unofficial/coach-mcp?label=coach-mcp)](https://www.npmjs.com/package/@trainheroic-unofficial/coach-mcp)
[![athlete-mcp](https://img.shields.io/npm/v/@trainheroic-unofficial/athlete-mcp?label=athlete-mcp)](https://www.npmjs.com/package/@trainheroic-unofficial/athlete-mcp)
[![cli](https://img.shields.io/npm/v/@trainheroic-unofficial/cli?label=cli)](https://www.npmjs.com/package/@trainheroic-unofficial/cli)

> Drive the TrainHeroic coaching API from Claude and other AI assistants, or from your own scripts.

[TrainHeroic](https://www.trainheroic.com) is a strength-and-conditioning platform: a coach programs workouts for a roster of athletes, and each athlete logs their training. This project wraps its (undocumented) API as a Claude Code skill, [MCP](https://modelcontextprotocol.io) servers (Model Context Protocol, the standard Claude and other assistants use to call external tools), and a CLI. You sign in with an existing TrainHeroic account; this does not create one.

> **Credentials:** every entry point below authenticates with your real TrainHeroic email and password. Wherever you put them (a shell `export`, an MCP config file, a `claude mcp add -e` flag), they are stored in plaintext and may land in shell history. Treat them like any other secret. The hosted server holds credentials server-side behind OAuth.

## Contents

- [What you can do](#what-you-can-do)
- [Skill](#skill)
- [MCP server](#mcp-server)
- [CLI](#cli)
- [Packages](#packages)
- [Disclaimer](#disclaimer)

## What you can do

| Account | Capabilities |
| --- | --- |
| **Coach** | Build and publish workouts · manage athletes, teams, and programs · read analytics · send messages |
| **Athlete** | Review training history · track PRs and progress on a lift over time · see what's programmed · export your data |

A coach account also carries athlete scope, so it can reach its own training data through the athlete tools.

## Skill

The recommended path for Claude Code. Install it with one command:

```bash
npx skills add alandotcom/trainheroic-unofficial
```

Set your credentials in the environment:

```bash
export TRAINHEROIC_EMAIL=coach@example.com
export TRAINHEROIC_PASSWORD=yourpassword
```

Then type `/trainheroic-unofficial` in a Claude Code session to activate it. The skill installs the CLI it runs on the first time you use it.

## MCP server

Connect a hosted server (OAuth login, runs in the cloud) or a local one (runs on your machine, credentials from your environment).

The hosted URL is:

```
https://mcp.trainheroic-unofficial.com/mcp
```

The tools the hosted server exposes depend on the account you log in with: a coach account gets the coaching tools **and** its own athlete training tools; an athlete account gets the athlete tools. (For the local servers below, pick by account: a coach runs the **coach** server, which already includes the athlete tools; the **athlete** server is for athlete-only accounts.)

Two extra paths expose a single tool set, for when you keep separate accounts or want a connection scoped to one role: `https://mcp.trainheroic-unofficial.com/mcp/coach` (coaching tools only) and `.../mcp/athlete` (athlete training tools only). Same login; the coach path is empty for an athlete account.

Every hosted connection also gets a **report a bug / send feedback** tool: ask the assistant to report a problem and it files the report (with your session and the last few tool calls attached) for the maintainers.

<details open>
<summary><b>Claude.ai</b></summary>

<br>

Open [Settings → Connectors → Add custom connector](https://claude.ai/customize/connectors?modal=add-custom-connector), paste the hosted URL above, and authenticate with your TrainHeroic email and password when prompted.

</details>

<details>
<summary><b>Claude Code</b></summary>

<br>

**Hosted**

```bash
claude mcp add trainheroic --transport http \
  https://mcp.trainheroic-unofficial.com/mcp
```

**Local: coach** (full coaching surface, plus your own athlete training)

```bash
claude mcp add trainheroic \
  -e TRAINHEROIC_EMAIL=coach@example.com \
  -e TRAINHEROIC_PASSWORD=yourpassword \
  -- npx -y @trainheroic-unofficial/coach-mcp
```

**Local: athlete** (history, workouts, PRs, working maxes)

```bash
claude mcp add trainheroic-athlete \
  -e TRAINHEROIC_EMAIL=athlete@example.com \
  -e TRAINHEROIC_PASSWORD=yourpassword \
  -- npx -y @trainheroic-unofficial/athlete-mcp
```

</details>

<details>
<summary><b>Claude Desktop and other stdio clients</b></summary>

<br>

Add this to your `.mcp.json` (or the client's MCP config):

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

For the athlete server, swap the package name to `@trainheroic-unofficial/athlete-mcp` and use your athlete credentials.

</details>

## CLI

A command-line tool (installed as a global npm package) for scripting and automation:

```bash
npm install -g @trainheroic-unofficial/cli
export TRAINHEROIC_EMAIL=coach@example.com TRAINHEROIC_PASSWORD=yourpassword

trainheroic whoami            # confirm auth (shared)
trainheroic coach athletes    # coach: list your roster
trainheroic athlete profile   # athlete: lifetime totals + profile
trainheroic athlete export    # athlete: dump training history to JSON
trainheroic help
```

## Packages

| Package | Description |
| --- | --- |
| [`@trainheroic-unofficial/dto`](packages/dto) | zod schemas and types, the source of truth for API shapes |
| [`@trainheroic-unofficial/js`](packages/js) | the runtime-agnostic SDK (client, auth, encoder, exercise library) |
| [`@trainheroic-unofficial/core`](packages/core) | the shared MCP tool layer, reused by every server |
| [`@trainheroic-unofficial/coach-mcp`](packages/coach-mcp) | local stdio MCP server for a coach |
| [`@trainheroic-unofficial/athlete-mcp`](packages/athlete-mcp) | local stdio MCP server for an athlete |
| [`@trainheroic-unofficial/cloudflare`](packages/cloudflare) | the hosted multi-tenant Worker (OAuth + D1) |
| [`@trainheroic-unofficial/cli`](packages/cli) | the command-line tool |

## Disclaimer

Unofficial, not affiliated with or endorsed by TrainHeroic. Use against your own account at your own risk. The TrainHeroic API is undocumented and may change.

## License

MIT
