# @trainheroic-unofficial/cloudflare

The hosted, multi-tenant TrainHeroic MCP server, deployed as a Cloudflare Worker. Each coach
authenticates over OAuth 2.1, and the worker stores per-tenant data in D1. It serves the
shared tool set from `@trainheroic-unofficial/core` plus a set of D1-backed warehouse sync
tools that only exist here.

Part of the [trainheroic-unofficial](../../../README.md) workspace. For a single-user setup
with no Cloudflare account, use the `local` package instead. Deployment is documented in
[DEPLOY.md](./DEPLOY.md).

## How it fits together

- `src/index.ts` wires `@cloudflare/workers-oauth-provider`: `/mcp` is the API route served
  by the Durable Object, a separate handler serves the auth pages, and a daily cron purges
  expired OAuth records.
- `src/agent.ts` is the `McpAgent` Durable Object (one instance per client session). It
  builds a `ToolContext` from the coach's stored credentials and a D1-backed exercise store,
  then registers the core tools plus the warehouse sync tools.
- `src/auth/` holds the TrainHeroic login flow shown at `/authorize` and its crypto helpers.
- `src/store/` holds the per-tenant D1 layer: an exercise mirror that implements the same
  `ExerciseIndex` interface the SDK defines, plus the programming and messaging warehouse
  zones. `src/tools/sync.ts` exposes those zones as MCP tools.

## Authentication

Two layers sit back to back. Between the MCP client and the worker, the worker is a full
OAuth 2.1 authorization server (PKCE S256 only, dynamic client registration, protected and
authorization-server metadata served by the library; an unauthenticated `/mcp` request gets
a 401 with a `WWW-Authenticate` challenge). Between the worker and TrainHeroic, the user
enters their TrainHeroic email and password on the `/authorize` page; the worker validates
them against `apis.trainheroic.com/auth` and keeps them in the grant's end-to-end-encrypted
`props`. The inbound MCP token is never sent upstream. TrainHeroic has no refresh token, so
the worker re-logs in with the stored credentials when a session expires.

## Local development

There is no checked-in `.dev.vars.example`. Create a `.dev.vars` with at least the cookie
key:

```
COOKIE_ENCRYPTION_KEY=<output of: openssl rand -hex 32>
ALLOWED_EMAILS=                # optional, comma-separated allowlist
```

Then:

```bash
pnpm install
pnpm cf-typegen          # regenerate worker-configuration.d.ts
pnpm db:migrate:local    # apply migrations to the local D1
pnpm dev                 # wrangler dev (local workerd + Miniflare) on http://localhost:8787
```

`wrangler dev` runs the full server locally with no Cloudflare account. Point MCP Inspector
or the Cloudflare AI Playground at `http://localhost:8787/mcp`, complete the TrainHeroic
login, and call a read tool.

## Bindings and config

`wrangler.jsonc` declares a KV namespace (`OAUTH_KV`, managed by the OAuth library), a D1
database (`TH_DB`), and the Durable Object (`MCP_OBJECT` / `TrainHeroicMCP`), plus the daily
cron. The KV and D1 ids are placeholders that must be filled before deploying. The only
secret the code requires is `COOKIE_ENCRYPTION_KEY`; `ALLOWED_EMAILS` is optional.

## Commands

These scripts exist in this package, not at the workspace root.

```bash
pnpm dev                 # wrangler dev
pnpm deploy              # wrangler deploy (see DEPLOY.md for one-time setup)
pnpm cf-typegen          # wrangler types
pnpm db:migrate          # apply migrations to the remote D1
pnpm db:migrate:local    # apply migrations to the local D1
pnpm typecheck
pnpm test                # vitest inside workerd via @cloudflare/vitest-pool-workers
```
