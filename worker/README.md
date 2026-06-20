# TrainHeroic MCP

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that wraps
the (reverse-engineered) TrainHeroic coaching API, deployed as a Cloudflare Worker.
It lets an MCP client (Claude and others) authenticate a TrainHeroic coach and manage
athletes, teams, programs, sessions, exercises, analytics, and chat.

Built on `@cloudflare/workers-oauth-provider` (OAuth 2.1) and the Agents SDK
`McpAgent`, with D1 for the per-tenant data store. It is the hosted counterpart to the
local `trainheroic-api` Python skill; see `../docs/` for the architecture and build
plan, and `../docs/mcp-spec-grounding.md` for the MCP `2025-11-25` compliance notes.

## How auth works

Two distinct layers:

1. **MCP client to server.** The Worker is a full OAuth 2.1 authorization server
   (`workers-oauth-provider`). An MCP client discovers it via
   `/.well-known/oauth-protected-resource`, registers dynamically, runs the PKCE
   (S256) authorization-code flow, and gets a bearer token. Unauthenticated `/mcp`
   requests return 401 with a `WWW-Authenticate` challenge.
2. **Server to TrainHeroic.** At `/authorize` the user enters their TrainHeroic email
   and password. The Worker validates them against `apis.trainheroic.com/auth` and
   stores them in the grant's end-to-end-encrypted `props` (encrypted by the library
   with the issued token as key material). TrainHeroic has no refresh token, so the
   server re-logs in with the stored credentials when the ~1-2h session expires.

The inbound MCP token is never forwarded upstream; only the user's TrainHeroic
`session-token` is sent to TrainHeroic.

## Tool catalog (33 tools)

Reads are `readOnlyHint`. Athlete-facing or destructive tools (`message_send`,
`message_delete`, `workout_publish`, `session_remove`) are gated by MCP elicitation
and also accept `confirm: true` for clients without elicitation support.

**Coach reads:** `whoami`, `head_coach`, `list_athletes`, `list_teams`, `get_team`,
`list_team_codes`, `list_programs`, `get_program`, `notifications`,
`analytics_categories`.

**Escape hatch:** `th_request` (any endpoint; GET is ungated, POST/PUT/DELETE require confirmation like the dedicated destructive tools).

**Exercises (D1 mirror):** `exercise_resolve`, `exercise_search`, `exercise_get`,
`exercise_sync`, `exercise_create`, `exercise_forget`, `store_stats`.

**Workouts:** `workout_build` (draft), `workout_read`, `workout_publish` (gated),
`session_remove` (gated).

**Warehouse syncs + stored reads:** `programming_sync`, `programming_get`,
`programming_session`, `messaging_sync`, `messaging_streams`, `messaging_history`.

**Live messaging:** `messaging_conversations`, `messaging_read`, `message_draft`
(preview only), `message_send` (gated), `message_delete` (gated).

## Local development

```bash
pnpm install
cp .dev.vars.example .dev.vars       # set COOKIE_ENCRYPTION_KEY; ALLOWED_EMAILS optional
pnpm cf-typegen                      # regenerate worker-configuration.d.ts
pnpm db:migrate:local                # apply migrations to the local D1
pnpm dev                             # wrangler dev on http://localhost:8787
```

Connect MCP Inspector or the Cloudflare AI Playground to `http://localhost:8787/mcp`,
complete the TrainHeroic login, and exercise a read tool such as `whoami`.

### Checks

```bash
pnpm check        # fmt:check + lint + typecheck + test
pnpm test         # vitest (runs inside workerd via @cloudflare/vitest-pool-workers)
```

## Deployment

See `DEPLOY.md` for the full walkthrough. In short: create the KV namespace and D1
database, paste their ids into `wrangler.jsonc`, set the production secrets, apply
migrations, and `pnpm deploy`. Then add the deployed `/mcp` URL to your MCP client.

## Storage

- **KV (`OAUTH_KV`)** — OAuth grants, hashed tokens, client registrations
  (library-managed). A daily cron calls `purgeExpiredData`.
- **Durable Object (`MCP_OBJECT` / `TrainHeroicMCP`)** — one McpAgent instance per
  client session; holds the live TrainHeroic session in memory.
- **D1 (`TH_DB`)** — per-tenant (`org_id`) app data: the exercise mirror plus the
  programming and messaging zones, and a lightweight `account` registry (last-seen per
  coach). Migrations live in `migrations/`.

## Security notes

- PKCE S256 only (`allowPlainPKCE: false`). RFC 9728 protected-resource metadata and
  RFC 8414 authorization-server metadata are served by the library.
- `/authorize` uses a double-submit CSRF token, an HMAC-signed round-trip of the OAuth
  request, and `Content-Security-Policy: frame-ancestors 'none'` + `X-Frame-Options:
  DENY`.
- Credentials live only in the encrypted grant `props`, never in logs, `userId`, or
  `metadata`. Set `ALLOWED_EMAILS` to restrict which TrainHeroic accounts may connect.

## Limitations

- TrainHeroic's API is undocumented and reverse-engineered; shapes can change.
- No upstream refresh token exists, so the server stores credentials to re-login.
  This is acceptable for a private (single-org) deployment; reconsider for multi-org.
- Bulk syncs (`programming_sync` over many calendars/months) fan out subrequests and
  D1 writes; they are batched, but very large accounts may approach Worker limits.
- The destructive-action gate uses MCP elicitation; clients without elicitation must
  pass `confirm: true`.
