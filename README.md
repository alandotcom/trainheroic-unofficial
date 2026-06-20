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

This repo is a single pnpm workspace (Node >= 22, pnpm 10). Everything lives at the root.

```
packages/
  dto/                   zod schemas / DTOs, the single source of truth for shapes
  js/                    runtime-agnostic SDK (client, auth, workout encoder, exercises)
  core/                  shared MCP tool layer used by both servers
  coach-mcp/             local single-user stdio MCP server (no DB, no Cloudflare)
  cloudflare/            hosted multi-tenant Worker (OAuth + D1 + Durable Objects)
  cli/                   command-line tool over the SDK
```

The servers share their tool implementations (`packages/core`), the TrainHeroic client and
workout encoder (`packages/js`), and the shapes (`packages/dto`). What differs between them is
the transport, the auth, and the exercise/warehouse storage backend. Each package carries its
own README and CLAUDE.md.

## Getting started

```bash
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

## How auth works (hosted)

Two distinct layers:

1. **MCP client to server.** The Worker is a full OAuth 2.1 authorization server
   (`workers-oauth-provider`). An MCP client discovers it via
   `/.well-known/oauth-protected-resource`, registers dynamically, runs the PKCE (S256)
   authorization-code flow, and gets a bearer token. Unauthenticated `/mcp` requests return
   401 with a `WWW-Authenticate` challenge.
2. **Server to TrainHeroic.** At `/authorize` the user enters their TrainHeroic email and
   password. The Worker validates them against `apis.trainheroic.com/auth` and stores them in
   the grant's end-to-end-encrypted `props` (encrypted by the library with the issued token as
   key material). TrainHeroic has no refresh token, so the server re-logs in with the stored
   credentials when the session expires.

The inbound MCP token is never forwarded upstream; only the user's TrainHeroic `session-token`
is sent to TrainHeroic.

## Tool catalog

Reads are marked read-only. Athlete-facing or destructive tools (`message_send`,
`message_delete`, `workout_publish`, `session_remove`, and non-GET `th_request`) are gated by
MCP elicitation and also accept `confirm: true` for clients without elicitation support.

**Coach reads:** `whoami`, `head_coach`, `list_athletes`, `list_teams`, `get_team`,
`list_team_codes`, `list_programs`, `get_program`, `notifications`, `analytics_categories`.

**Escape hatch:** `th_request` (any endpoint; GET is ungated, POST/PUT/DELETE require
confirmation like the dedicated destructive tools).

**Exercises:** `exercise_resolve`, `exercise_search`, `exercise_get`, `exercise_sync`,
`exercise_create`, `exercise_forget`, `store_stats`.

**Workouts:** `workout_build` (draft), `workout_read`, `workout_publish` (gated),
`session_remove` (gated).

**Live messaging:** `messaging_conversations`, `messaging_read`, `message_draft` (preview
only), `message_send` (gated), `message_delete` (gated).

**History warehouse (hosted only):** `programming_sync` + `programming_stored`, and
`messaging_sync` + `messaging_stored`. Each zone has one verb to populate a D1 time-series
(prescribed history; conversation history) the live API cannot return in one call, and one
query tool to read it. They live in the `cloudflare` package; the local server does not have
them, and current data is read live via `get_program` / `messaging_conversations` /
`messaging_read`.

## Local single-user server (no Cloudflare, no database)

For personal use, run the stdio server. It needs only Node: no Cloudflare account, no
KV/D1/Durable Objects, no OAuth. Credentials come from the environment and the exercise library
is cached on disk (`~/.trainheroic/library.json`, overridable with `TRAINHEROIC_CACHE_FILE`).
Its tools are the shared core set, without the D1-backed warehouse syncs.

```bash
pnpm install
TRAINHEROIC_EMAIL="coach@example.com" TRAINHEROIC_PASSWORD="..." \
  pnpm --filter @trainheroic-unofficial/coach-mcp start
```

Register it with an MCP client (for example Claude Desktop) by command, args, and env. During
development you can point it at the source through `tsx`:

```jsonc
{
  "mcpServers": {
    "trainheroic": {
      "command": "npx",
      "args": ["tsx", "/abs/path/to/trainheroic-2/packages/coach-mcp/src/server.ts"],
      "env": { "TRAINHEROIC_EMAIL": "coach@example.com", "TRAINHEROIC_PASSWORD": "..." }
    }
  }
}
```

After `pnpm --filter @trainheroic-unofficial/coach-mcp build`, you can instead run the built
`trainheroic-coach-mcp` binary (`packages/coach-mcp/dist/server.mjs`), or install the prebuilt
`.mcpb` Claude Desktop extension; see
[packages/coach-mcp/README.md](packages/coach-mcp/README.md#install-as-a-claude-desktop-extension-mcpb).
The client launches the process and speaks MCP over stdio; the server calls the live
TrainHeroic API directly.

To poke at the tools by hand, run [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
against the stdio server. It spawns the server, then opens a web UI for listing and calling
tools:

```bash
TRAINHEROIC_EMAIL="coach@example.com" TRAINHEROIC_PASSWORD="..." \
  pnpm --filter @trainheroic-unofficial/coach-mcp inspect
```

The Inspector prints a `http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=...` URL; open it and
click Connect. See [packages/coach-mcp/README.md](packages/coach-mcp/README.md) for the CLI
(no-UI) variant.

## Hosted worker: local development

The worker's dev, deploy, type-generation, and migration scripts live in
`packages/cloudflare` (not at the workspace root), so run them from there.

```bash
pnpm install
cd packages/cloudflare
# Create .dev.vars with at least COOKIE_ENCRYPTION_KEY (e.g. `openssl rand -hex 32`);
# ALLOWED_EMAILS is optional.
pnpm cf-typegen                      # regenerate worker-configuration.d.ts
pnpm db:migrate:local                # apply migrations to the local D1
pnpm dev                             # wrangler dev (local workerd) on http://localhost:8787
```

`wrangler dev` runs the full hosted server in local workerd and Miniflare (local KV/D1/DO, no
Cloudflare account needed).

With `pnpm dev` running, point [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
(or the Cloudflare AI Playground) at it. From a second terminal in `packages/cloudflare`:

```bash
pnpm inspect    # opens the Inspector UI; no command, since it connects to a URL
```

In the UI, choose the **Streamable HTTP** transport, enter `http://localhost:8787/mcp`, and
Connect. Unlike the stdio server, the worker is OAuth-protected: the Inspector registers
dynamically and runs the authorization-code flow, which lands you on the worker's `/authorize`
page to enter your TrainHeroic email and password. After that, call a read tool.

### Checks

Run from the repo root; these fan out across every package.

```bash
pnpm check        # fmt:check + lint + typecheck + test
pnpm test         # vitest in every package (the cloudflare package runs inside workerd)
```

## Deployment

See [packages/cloudflare/DEPLOY.md](packages/cloudflare/DEPLOY.md) for the full walkthrough. In
short: create the KV namespace and D1 database, paste their ids into
`packages/cloudflare/wrangler.jsonc`, set the production secrets, apply migrations, and run
`pnpm deploy` from `packages/cloudflare`. Then add the deployed `/mcp` URL to your MCP client.

## Storage (hosted)

- **KV (`OAUTH_KV`):** OAuth grants, hashed tokens, and client registrations (library-managed).
  A daily cron calls `purgeExpiredData`.
- **Durable Object (`MCP_OBJECT` / `TrainHeroicMCP`):** one McpAgent instance per client
  session; holds the live TrainHeroic session in memory.
- **D1 (`TH_DB`):** per-tenant (`org_id`) app data, namely the exercise mirror, the programming
  and messaging zones, and a lightweight account registry. Migrations live in
  `packages/cloudflare/migrations/`.

## Security notes (hosted)

- PKCE S256 only (`allowPlainPKCE: false`). RFC 9728 protected-resource metadata and RFC 8414
  authorization-server metadata are served by the library.
- `/authorize` uses a double-submit CSRF token, an HMAC-signed round-trip of the OAuth request,
  and `Content-Security-Policy: frame-ancestors 'none'` with `X-Frame-Options: DENY`.
- Credentials live only in the encrypted grant `props`, never in logs, `userId`, or `metadata`.
  Set `ALLOWED_EMAILS` to restrict which TrainHeroic accounts may connect.

## Limitations

- TrainHeroic's API is undocumented; shapes can change.
- No upstream refresh token exists, so the server stores credentials to re-login. This is
  acceptable for a private (single-org) deployment; reconsider for multi-org.
- Bulk syncs (`programming_sync` over many calendars and months) fan out subrequests and D1
  writes. They are batched, but very large accounts may approach Worker limits.
- The destructive-action gate uses MCP elicitation; clients without elicitation must pass
  `confirm: true`.

## Disclaimer

Unofficial, and not affiliated with or endorsed by TrainHeroic. Use against your own account,
at your own risk.
