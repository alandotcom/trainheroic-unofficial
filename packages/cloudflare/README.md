# @trainheroic-unofficial/cloudflare

The hosted, multi-tenant TrainHeroic MCP server on Cloudflare Workers. Each coach signs in with their own TrainHeroic credentials through an OAuth flow; the worker stores per-tenant data in D1.

**To use the public hosted server**, see the [root README](../../README.md) — no deployment needed.

**To self-host your own instance**, follow [DEPLOY.md](./DEPLOY.md). You need a Cloudflare account on the Workers Paid plan (Durable Objects + D1 + cron).

---

## Local development

```bash
# In packages/cloudflare:
# 1. Create .dev.vars with at least:
#    COOKIE_ENCRYPTION_KEY=<openssl rand -hex 32>
#    ALLOWED_EMAILS=                # optional
pnpm cf-typegen          # regenerate worker-configuration.d.ts
pnpm db:migrate:local    # apply migrations to the local D1
pnpm dev                 # wrangler dev on http://localhost:8787
```

Point MCP Inspector at `http://localhost:8787/mcp` and complete the OAuth + TrainHeroic login flow.

```bash
pnpm inspect             # open Inspector UI (requires pnpm dev running)
pnpm deploy              # wrangler deploy (see DEPLOY.md first)
pnpm db:migrate          # apply migrations to the remote D1
pnpm typecheck
pnpm test                # runs inside workerd via @cloudflare/vitest-pool-workers
```
