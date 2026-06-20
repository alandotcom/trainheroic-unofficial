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
```

`ALLOWED_EMAILS` is a comma-separated allowlist of TrainHeroic emails permitted to authorize.
Leaving it unset means **open registration**: any valid TrainHeroic coach can connect. The
worker logs a warning on each such login so an unintentionally-open deployment is visible; set
`ALLOWED_EMAILS` to lock it down. No TrainHeroic credentials are stored as secrets; each user
enters their own at login.

## 3. Apply migrations to the remote D1

```bash
pnpm db:migrate        # wrangler d1 migrations apply trainheroic --remote
```

## 4. Deploy

```bash
pnpm deploy            # wrangler deploy
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

## Notes

- **Custom domain.** The library derives the protected-resource `resource` from the
  request origin, which is correct for the `workers.dev` host. Behind a custom domain
  that differs from the Worker hostname, set `resourceMetadata.resource` in
  `src/index.ts` to the canonical `/mcp` URL.
- **Re-deploying schema changes.** Add a new file under `migrations/` and re-run
  `pnpm db:migrate`. Never edit an already-applied migration.
- **Rotating `COOKIE_ENCRYPTION_KEY`.** Rotating it invalidates in-flight `/authorize`
  sessions (signed `oauth_req` + CSRF). Existing OAuth grants/tokens are unaffected
  (they are keyed by the library's own KV state).
