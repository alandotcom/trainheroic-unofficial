# trainheroic-unofficial

An unofficial TypeScript toolkit for the [TrainHeroic](https://www.trainheroic.com/)
coach/athlete REST API. The API is undocumented, so the shapes are reverse-engineered and can
change. One shared tool layer runs in three shapes:

- **Remote MCP server** on Cloudflare Workers: multi-tenant, OAuth 2.1, D1-backed. Each coach
  logs in and connects an MCP client (Claude and others).
- **Local MCP server** over stdio: single user, no database, credentials from the environment.
  Launch it from an MCP client such as Claude Desktop.
- **CLI**: `trainheroic <command>` for scripting the same operations from a shell.

It authenticates and renews the session, resolves exercise names to ids, builds and publishes
workouts from a JSON spec, manages athletes/teams/programs, reads analytics, and handles
messaging.

## Layout

```
mcp/                       pnpm workspace (the active project; Node >= 22, pnpm 10)
  packages/
    dto/                   zod schemas / DTOs, the single source of truth for shapes
    js/                    runtime-agnostic SDK (client, auth, workout encoder, exercises)
    core/                  shared MCP tool layer used by both servers
    local/                 local single-user stdio MCP server (no DB, no Cloudflare)
    cloudflare/            hosted multi-tenant Worker (OAuth + D1 + Durable Objects)
    cli/                   command-line tool over the SDK
  README.md                server-focused overview (auth model, tool catalog, dev, storage)
```

Each package under `mcp/packages/` carries its own README and CLAUDE.md.

## Getting started

The toolkit lives in `mcp/`. See [`mcp/README.md`](mcp/README.md) for the full picture: the
two-layer auth model, the tool catalog, local development, storage, and security notes.
Deployment of the hosted Worker is in
[`mcp/packages/cloudflare/DEPLOY.md`](mcp/packages/cloudflare/DEPLOY.md).

```bash
cd mcp
pnpm install

# Local single-user MCP server over stdio:
TRAINHEROIC_EMAIL="coach@example.com" TRAINHEROIC_PASSWORD="..." \
  pnpm --filter @trainheroic-unofficial/coach-mcp start

# CLI:
TRAINHEROIC_EMAIL="coach@example.com" TRAINHEROIC_PASSWORD="..." \
  pnpm --filter @trainheroic-unofficial/cli start whoami

# Hosted Worker, local dev (workerd + Miniflare; no Cloudflare account needed):
cd packages/cloudflare && pnpm db:migrate:local && pnpm dev   # http://localhost:8787/mcp
```

Credentials always come from `TRAINHEROIC_EMAIL` and `TRAINHEROIC_PASSWORD`. TrainHeroic
issues no refresh token, so the client re-logs in with the stored credentials when the session
expires. Local session and exercise-cache state is written under `~/.trainheroic/`, never in
the repo.

## Disclaimer

Unofficial, and not affiliated with or endorsed by TrainHeroic. Use against your own account,
at your own risk.
