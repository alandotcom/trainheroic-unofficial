# Deploying TrainHeroic MCP

A one-time setup to deploy the Worker to your Cloudflare account.

## Prerequisites

- A Cloudflare account on the Workers Paid plan (Durable Objects + D1 + cron).
- `wrangler` authenticated: `pnpm exec wrangler login`.
- `pnpm install` run in this directory.

## 1. Create the KV namespace and D1 database

```bash
pnpm exec wrangler kv namespace create OAUTH_KV
pnpm exec wrangler d1 create trainheroic
```

Paste the returned ids into `wrangler.jsonc`, replacing the placeholders:

- `kv_namespaces[0].id` ← the KV namespace id (add `preview_id` for `wrangler dev`).
- `d1_databases[0].database_id` ← the D1 database id.

Then regenerate types: `pnpm cf-typegen`.

## 2. Set secrets

```bash
pnpm exec wrangler secret put COOKIE_ENCRYPTION_KEY   # e.g. output of: openssl rand -hex 32
pnpm exec wrangler secret put ALLOWED_EMAILS          # optional: comma-separated TrainHeroic emails
pnpm exec wrangler secret put SENTRY_DSN              # optional: enables Sentry error reporting
```

`SENTRY_DSN` is the Sentry project DSN. It is a **secret, never a committed var**, so it stays
out of the repo. Leave it unset to run with Sentry disabled (every Sentry call is a no-op);
set it to turn on error reporting. Locally, put it in `.dev.vars` (gitignored) instead.

`ALLOWED_EMAILS` is a comma-separated allowlist of TrainHeroic emails permitted to authorize.
Leaving it unset means **open registration**: any valid TrainHeroic account, coach or athlete, can connect. The
worker logs a warning on each such login so an unintentionally-open deployment is visible; set
`ALLOWED_EMAILS` to lock it down. No TrainHeroic credentials are stored as secrets; each user
enters their own at login.

## 3. Apply migrations to the remote D1

```bash
pnpm db:migrate        # wrangler d1 migrations apply trainheroic --remote
```

## 4. Deploy

```bash
pnpm deploy            # from the repo root, or `pnpm deploy` in this package
```

`deploy` runs `scripts/deploy.sh`: it builds and ships the Worker (`wrangler deploy`, which
emits source maps because `upload_source_maps` is on) and tags the release with the short git
sha. If `SENTRY_AUTH_TOKEN` is set, it then uploads the source maps to Sentry under that
release so stack traces resolve to the original TypeScript; without the token it deploys and
skips that step. `pnpm deploy:plain` is the bare `wrangler deploy` escape hatch.

The token is read from `.env` at the repo root automatically (gitignored); set
`SENTRY_AUTH_TOKEN` there, or pass it inline. Use an organization auth token (`org:ci` scope)
from <https://sentry.io/settings/auth-tokens/>.

```bash
SENTRY_AUTH_TOKEN=sntrys_… pnpm deploy   # or just `pnpm deploy` once it is in .env
```

The daily KV-hygiene cron (`triggers.crons`) is deployed with the Worker and calls
`purgeExpiredData`.

## 5. Connect an MCP client

Add the deployed Streamable HTTP endpoint to your client:

```
https://trainheroic-mcp.<your-subdomain>.workers.dev/mcp
```

The client runs dynamic client registration and the OAuth flow automatically. The
browser opens the TrainHeroic login page; after sign-in the client receives its token
and the tools become available.

MCP Inspector and the Cloudflare AI Playground connect to the URL directly. Claude Desktop
needs the `mcp-remote` bridge with `--transport http-only`:

```jsonc
{
  "mcpServers": {
    "trainheroic": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://trainheroic-mcp.<your-subdomain>.workers.dev/mcp",
        "--transport",
        "http-only",
      ],
    },
  },
}
```

## Notes

- **Custom domain.** The library derives the protected-resource `resource` from the
  request origin, which is correct for the `workers.dev` host. Behind a custom domain
  that differs from the Worker hostname, set `resourceMetadata.resource` in
  `src/index.ts` to the canonical `/mcp` URL.
- **Rate limiting.** Two native bindings in `wrangler.jsonc` under `ratelimits`
  (`LOGIN_RATE_LIMITER` for the login surface, `MCP_RATE_LIMITER` for `/mcp`), keyed on client
  IP at the edge. Tune `limit`/`period` (period is 10 or 60); rerun `pnpm cf-typegen` after
  editing. Counters are best-effort and per-colo.
- **Re-deploying schema changes.** Add a new file under `migrations/` and re-run
  `pnpm db:migrate`. Never edit an already-applied migration.
- **Rotating `COOKIE_ENCRYPTION_KEY`.** Rotating it invalidates in-flight `/authorize`
  sessions (signed `oauth_req` + CSRF). Existing OAuth grants/tokens are unaffected
  (they are keyed by the library's own KV state).
- **Error monitoring (Sentry).** Configured in `src/sentry.ts` and gated on the `SENTRY_DSN`
  secret. `withSentry` reports errors from the top-level fetch and cron handlers;
  `instrumentDurableObjectWithSentry` reports errors from inside the MCP Durable Object, tagged
  with the signed-in user's email. By design the only data sent is the error and that email:
  `sendDefaultPii` is off (no IPs/cookies/auth headers), request bodies are never captured
  (so the login POST password cannot leak), and performance tracing is off. Readable stack
  traces come from source map upload, which `pnpm deploy` does automatically when
  `SENTRY_AUTH_TOKEN` is set (see step 4). The Sentry org/project default to
  `alan-zy`/`trainheroic-mcp` and are overridable via `SENTRY_ORG`/`SENTRY_PROJECT`.
