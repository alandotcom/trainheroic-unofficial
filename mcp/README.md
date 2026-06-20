# TrainHeroic MCP

A [Model Context Protocol](https://modelcontextprotocol.io) server that wraps the TrainHeroic
coaching API. It lets an MCP client (Claude and others) authenticate a TrainHeroic coach and
manage athletes, teams, programs, sessions, exercises, analytics, and chat.

This is the `mcp/` pnpm workspace. The same tool layer runs in three shapes, each with its
own package and its own README:

- **Hosted, multi-tenant** ([packages/cloudflare](packages/cloudflare/README.md)): a
  Cloudflare Worker using `@cloudflare/workers-oauth-provider` (OAuth 2.1) and the Agents SDK
  `McpAgent`, with D1 for per-tenant storage. Multiple coaches each log in via OAuth. Entry:
  `packages/cloudflare/src/index.ts`.
- **Local, single-user** ([packages/local](packages/local/README.md)): an MCP server over
  stdio with no OAuth and no database. Credentials come from the environment and the exercise
  library is cached on disk. Entry: `packages/local/src/server.ts`.
- **CLI** ([packages/cli](packages/cli/README.md)): the same operations from a shell, calling
  the SDK directly.

The servers share their tool implementations (`packages/core`), the TrainHeroic client and
workout encoder (`packages/js`), and the shapes (`packages/dto`). What differs between them is
the transport, the auth, and the exercise/warehouse storage backend.

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

Results are size-bounded to stay under the host's tool-result cap: an oversized result is
trimmed and labeled with a `__truncated` marker. Raise the budget for a local run with
`TH_MCP_RESULT_BUDGET`.

**Coach reads:** `whoami`, `head_coach`, `list_athletes` (optional `q` / `limit`),
`list_teams`, `get_team`, `list_team_codes`, `list_programs`, `get_program`, `notifications`,
`analytics_categories`.

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
      "args": ["tsx", "/abs/path/to/mcp/packages/local/src/server.ts"],
      "env": { "TRAINHEROIC_EMAIL": "coach@example.com", "TRAINHEROIC_PASSWORD": "..." }
    }
  }
}
```

After `pnpm --filter @trainheroic-unofficial/coach-mcp build`, you can instead run the built
`trainheroic-coach-mcp` binary (`packages/local/dist/server.mjs`). The client launches the
process and speaks MCP over stdio; the server calls the live TrainHeroic API directly.

Or install the prebuilt Claude Desktop extension: download `trainheroic-coach-mcp.mcpb` from the
[Releases page](https://github.com/alandotcom/trainheroic-skill/releases), drag it onto Desktop,
and enter your credentials. See
[packages/local/README.md](packages/local/README.md#install-as-a-claude-desktop-extension-mcpb).

To poke at the tools by hand, run [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
against the stdio server. It spawns the server, then opens a web UI for listing and calling
tools:

```bash
TRAINHEROIC_EMAIL="coach@example.com" TRAINHEROIC_PASSWORD="..." \
  pnpm --filter @trainheroic-unofficial/coach-mcp inspect
```

The Inspector prints a `http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=...` URL; open it and
click Connect. See [packages/local/README.md](packages/local/README.md) for the CLI (no-UI)
variant.

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

Run from the workspace root (`mcp/`); these fan out across every package.

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
- Per-IP edge rate limiting (Cloudflare's native binding, configured in `wrangler.jsonc` under
  `ratelimits`): tight on the login surface, looser on `/mcp`. Best-effort, not an exact quota.

## Limitations

- TrainHeroic's API is undocumented; shapes can change.
- No upstream refresh token exists, so the server stores credentials to re-login. This is
  acceptable for a private (single-org) deployment; reconsider for multi-org.
- Bulk syncs (`programming_sync` over many calendars and months) fan out subrequests and D1
  writes. They are batched, but very large accounts may approach Worker limits.
- The destructive-action gate uses MCP elicitation; clients without elicitation must pass
  `confirm: true`.
