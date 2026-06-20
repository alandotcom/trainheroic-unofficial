# trainheroic-unofficial

[![dto](https://img.shields.io/npm/v/@trainheroic-unofficial/dto?label=dto)](https://www.npmjs.com/package/@trainheroic-unofficial/dto)
[![js](https://img.shields.io/npm/v/@trainheroic-unofficial/js?label=js)](https://www.npmjs.com/package/@trainheroic-unofficial/js)
[![core](https://img.shields.io/npm/v/@trainheroic-unofficial/core?label=core)](https://www.npmjs.com/package/@trainheroic-unofficial/core)
[![coach-mcp](https://img.shields.io/npm/v/@trainheroic-unofficial/coach-mcp?label=coach-mcp)](https://www.npmjs.com/package/@trainheroic-unofficial/coach-mcp)
[![athlete-mcp](https://img.shields.io/npm/v/@trainheroic-unofficial/athlete-mcp?label=athlete-mcp)](https://www.npmjs.com/package/@trainheroic-unofficial/athlete-mcp)
[![cli](https://img.shields.io/npm/v/@trainheroic-unofficial/cli?label=cli)](https://www.npmjs.com/package/@trainheroic-unofficial/cli)

Unofficial TrainHeroic tools for Claude and other AI assistants. As a **coach**: build and publish workouts, manage athletes, teams, and programs, read analytics, and send messages. As an **athlete**: review your training history, track progress and PRs on a lift over time, see what's programmed, and export your data. (A coach account also has athlete-scoped training data.)

## Skill (recommended)

The skill teaches Claude Code to drive TrainHeroic. Install it with one command:

```bash
npx skills add alandotcom/trainheroic-unofficial
```

Set your credentials in the environment:

```bash
export TRAINHEROIC_EMAIL=coach@example.com
export TRAINHEROIC_PASSWORD=yourpassword
```

Then type `/trainheroic-unofficial` in a Claude Code session to activate it. The skill installs the CLI it runs on the first time you use it, so there's nothing else to set up.

## MCP server

For Claude.ai, Claude Desktop, or any other MCP client.

**Hosted** — OAuth login, no install, credentials stored server-side. The tools you get depend on the account you log in with: a coach account gets the coaching tools **and** its own athlete training tools; an athlete account gets the athlete tools.

```bash
claude mcp add trainheroic --transport http \
  https://trainheroic-mcp.alandotcom.workers.dev/mcp
```

For Claude.ai, add it under [Settings → Connectors → Add custom connector](https://claude.ai/customize/connectors?modal=add-custom-connector) using the same URL.

**Local (coach)** — runs on your machine, credentials stay in your environment:

```bash
claude mcp add trainheroic \
  -e TRAINHEROIC_EMAIL=coach@example.com \
  -e TRAINHEROIC_PASSWORD=yourpassword \
  -- npx -y @trainheroic-unofficial/coach-mcp
```

**Local (athlete)** — the athlete surface (history, workouts, PRs, working maxes):

```bash
claude mcp add trainheroic-athlete \
  -e TRAINHEROIC_EMAIL=athlete@example.com \
  -e TRAINHEROIC_PASSWORD=yourpassword \
  -- npx -y @trainheroic-unofficial/athlete-mcp
```

Claude Desktop uses the same settings in `.mcp.json`; see [packages/cloudflare](packages/cloudflare), [packages/coach-mcp](packages/coach-mcp), and [packages/athlete-mcp](packages/athlete-mcp) for details.

## CLI

A standalone command-line tool for scripting and automation:

```bash
npm install -g @trainheroic-unofficial/cli
export TRAINHEROIC_EMAIL=coach@example.com TRAINHEROIC_PASSWORD=yourpassword

trainheroic whoami            # coach: confirm auth
trainheroic athlete profile   # athlete: lifetime totals + profile
trainheroic athlete export    # dump your training history to JSON
trainheroic help
```

## Disclaimer

Unofficial, not affiliated with or endorsed by TrainHeroic. Use against your own account at your own risk. The TrainHeroic API is undocumented and may change.
