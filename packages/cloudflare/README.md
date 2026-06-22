# @trainheroic-unofficial/cloudflare

The hosted, multi-tenant [TrainHeroic](https://www.trainheroic.com) [MCP](https://modelcontextprotocol.io) server on [Cloudflare Workers](https://developers.cloudflare.com/workers/). It runs the same tools as the local servers and supports many users concurrently, with each user signing in through an OAuth flow so their TrainHeroic credentials are held server-side. Per-tenant data (the exercise mirror and the training warehouse) lives in [D1](https://developers.cloudflare.com/d1/), Cloudflare's SQLite database, scoped by account.

**To use the public hosted server**, see the [root README](../../README.md); it connects directly from your MCP client.

**To self-host your own instance**, follow [DEPLOY.md](./DEPLOY.md). You need a Cloudflare account on the Workers Paid plan, which this server requires for [Durable Objects](https://developers.cloudflare.com/durable-objects/) (one per session, holding the MCP agent), D1, and a [cron trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/) (a scheduled purge job).

---

## Local development

This runs the worker locally with no Cloudflare account, using Miniflare (a local Workers runtime) and a local D1 file. First run `pnpm install` once at the repo root (Node >= 24, pnpm 11), then from `packages/cloudflare`:

1. Create a `.dev.vars` file (wrangler's local-secrets file). The full set of variables:
   - `COOKIE_ENCRYPTION_KEY` (**required**): signs the OAuth/CSRF round-trip values. Generate one with `openssl rand -hex 32` and paste the output as the value.
   - `ALLOWED_EMAILS` (optional): comma-separated allowlist of TrainHeroic emails permitted to register; empty or unset allows any.
   - `SENTRY_DSN` (optional): enables error reporting, aggregate usage metrics (auth + per tool call), and per-session tracing; unset disables all of it. The traces sample rate is the `SENTRY_TRACES_SAMPLE_RATE` var (default `1`, in `wrangler.jsonc`), adjustable from the Cloudflare dashboard at runtime.

   ```
   COOKIE_ENCRYPTION_KEY=2f1c...your-generated-hex
   ALLOWED_EMAILS=
   ```

2. Generate types, migrate the local D1, and start the dev server:

   ```bash
   pnpm cf-typegen          # generate worker-configuration.d.ts (re-run after binding changes)
   pnpm db:migrate:local    # apply migrations to the local D1
   pnpm dev                 # wrangler dev on http://localhost:8787
   ```

3. With `pnpm dev` running, launch the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) (the official MCP debugging UI), point it at `http://localhost:8787/mcp`, and complete the OAuth + TrainHeroic login flow. Two extra paths expose a single tool set for separate accounts or a connection scoped to one role: `http://localhost:8787/mcp/coach` (coaching tools only) and `http://localhost:8787/mcp/athlete` (athlete tools only):

   ```bash
   pnpm inspect             # fetches and opens the Inspector UI via npx
   ```

Typecheck and tests run locally with no Cloudflare account:

```bash
pnpm typecheck
pnpm test                # runs inside workerd (Cloudflare's runtime) via @cloudflare/vitest-pool-workers
```

Deploying and migrating the remote database do need a Cloudflare account and wrangler auth
(`wrangler login` or a `CLOUDFLARE_API_TOKEN` env var); see [DEPLOY.md](./DEPLOY.md) for the
one-time setup:

```bash
pnpm deploy              # wrangler deploy
pnpm db:migrate          # apply migrations to the remote D1
```
