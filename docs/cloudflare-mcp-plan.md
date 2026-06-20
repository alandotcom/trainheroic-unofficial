# TrainHeroic MCP on Cloudflare — Build Plan

Turn the `trainheroic-api` skill into a hosted, multi-tenant remote MCP server on
Cloudflare Workers, with OAuth for MCP clients and D1 for application data.

## Decisions (locked)

| Decision | Choice | Consequence |
|---|---|---|
| Tenancy | Private (you / your org) | No public signup. Optional email allowlist as defense. Minimal abuse surface. |
| TrainHeroic credential storage | Encrypted password + re-login (revised after Phase 0) | TH issues no refresh token and exposes no refresh endpoint; re-login is the only renewal. Store email + password encrypted (AES-GCM, Worker secret) in D1, re-login on 401. Private tenancy keeps custody to your own org. |
| v1 scope | Full parity | Port every script: client, exercise store, programming sync, messaging sync + send, workout builder. |

## Phase 0 findings (spike complete)

Tested against the live trial coach account.

- **Login response is minimal.** `POST apis.trainheroic.com/auth` returns only
  `{ id, scope, role, session_id }`. No `refresh_token`, no `api_token`, no
  `api_ttl` — the skill reads those keys but they are absent.
- **No refresh token, no refresh endpoint.** Every candidate refresh/extend endpoint
  (`/auth/refresh`, `/auth/token`, `/session/refresh`, `/auth/extend`, on both
  hosts) returned 404/405. The only renewal path is to re-POST email + password to
  `/auth`.
- **The session token works on both hosts.** The 48-char `session_id` sent as the
  `session-token` header authenticated `GET api.trainheroic.com/user/simple` and
  `GET apis.trainheroic.com/user`. The skill's separate `api-token` path looks
  unnecessary for at least these endpoints; verify across more before dropping it.
- **Session TTL** is server-side and unadvertised (no `api_ttl` in the response).
  Memory puts it at ~1–2h. Detect expiry via 401/403 and re-login, as the skill does.

**Consequence:** refresh-token-only is impossible. The backend must store the
password (encrypted) and re-login to renew. Private tenancy (your own org) is what
makes holding those credentials acceptable. The credential row above is revised
accordingly.

## Language: TypeScript vs Python

Python Workers can host MCP servers (Cloudflare supports the Python MCP SDK / FastMCP
inside a Durable Object, with Streamable HTTP + SSE). It is still **beta** and needs
the `python_workers` compatibility flag. For this project the choice resolves to
TypeScript, for three reasons:

1. **The I/O layer rewrites either way.** `th_client.py` uses `urllib`, which relies
   on sockets; sockets are non-functional in the WASM runtime. HTTP moves to `fetch`
   (or async `httpx`). The `sqlite3` on-disk store moves to D1 because Workers have no
   persistent local disk. So the HTTP and storage layers change regardless of language.
2. **The auth library is TS-only.** `workers-oauth-provider` and `McpAgent` are
   TypeScript (Agents SDK); there is no maintained Python equivalent. A Python build
   means hand-rolling OAuth 2.1 (PKCE, dynamic client registration, the `.well-known`
   metadata endpoints) or running a TS shell Worker for OAuth that forwards to a Python
   Worker over a service binding. Auth is in scope (full parity), so this dominates.
3. **Beta runtime, hardest component.** Building the security-sensitive auth piece on
   the less-mature runtime is the wrong place to spend risk.

**What Python would preserve** is the pure, I/O-free logic: the workout spec → payload
encoding in `build_workout.py` (the `param_*_data_N` slots, prescriptions, supersets,
leaderboards), the exercise ranking, the month-window walk. Porting those functions to
TS is less ongoing complexity than a cross-language service binding.

**Decision: TypeScript server.** Keep the Python skill as the local/dev path and the
reference spec. **Middle path** if the encoding logic is large enough to be worth not
re-deriving: TS handles the OAuthProvider + McpAgent shell, a Python Worker holds the
build logic behind a service binding (more moving parts, keeps the workout brain in
Python).

## Architecture

```
MCP client (Claude)
      │  OAuth 2.1 (PKCE, dynamic client reg)
      ▼
┌─────────────────────────────────────────────┐
│ Worker entrypoint = OAuthProvider             │
│  ├─ /authorize, /token, /register  (library)  │
│  ├─ defaultHandler  → TrainHeroic login form  │  ← user types TH email/pw here
│  └─ apiHandler "/mcp" → McpAgent (DO)          │  ← tools run here, see this.props
└─────────────────────────────────────────────┘
      │ this.props = { th_user_id, org_id, session_id, role }  (creds in D1, not props)
      ▼
TrainHeroic REST API  (fetch with session-token / api-token headers)

Storage:
  OAUTH_KV   (KV)  → OAuth grants, hashed tokens, client registrations  [library-owned]
  McpAgent   (DO)  → live per-connection session state                  [per-token]
  TH_DB      (D1)  → exercise mirror, programming, messaging, accounts   [shared, per-tenant]
```

Two auth layers, kept distinct:

1. **MCP client ↔ server**: `@cloudflare/workers-oauth-provider` is a full OAuth 2.1
   authorization server. It issues Claude its own token, handles PKCE, dynamic
   client registration, refresh, and validation. This is option 4 in Cloudflare's
   [authorization guide](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)
   (the Worker handles auth itself).
2. **Server ↔ TrainHeroic**: the login form rendered at `/authorize` collects TH
   credentials, validates them against `apis.trainheroic.com/auth`, and stores the
   returned session bundle in the grant's `props`.

## Auth flow

1. Claude calls `/mcp`, receives 401, opens `/authorize` in a browser.
2. `defaultHandler` renders a TrainHeroic login form (email + password). Add a
   consent line naming what the agent will be able to do.
3. On submit, the Worker `POST`s the form to `apis.trainheroic.com/auth`. On
   success TH returns `{ id, scope, role, session_id }` (see Phase 0 findings — no
   refresh token or TTL).
4. Optional allowlist: reject if the TH email is not in `ALLOWED_EMAILS`.
5. Encrypt the email + password (AES-GCM, Worker secret) and upsert the credential
   row in D1, keyed by `th_user_id`. Then
   `completeAuthorization({ userId: th_user_id, scope, metadata: { email }, props })`
   where `props = { th_user_id, org_id, session_id, role }`. Props are end-to-end
   encrypted with the issued token as key material, so a leak reveals nothing usable.
   The password lives only in the D1 credential row (its own encryption), never in
   props.
6. The provider issues Claude an access + refresh token.
7. Every `/mcp` request reaches the `McpAgent` with `this.props` populated. Tools
   call TH using `this.props.session_id` / `api_token`. No env vars, no shared
   credentials, fully per-tenant.

### Keeping the TH session fresh

There is no upstream refresh token, so the session is renewed by re-login. Two
layers cooperate:

- **Reactive (primary).** The shared client layer retries once on a 401/403: decrypt
  the D1 credential row, re-POST to `/auth`, update `session_id` in the agent's
  in-memory state, retry the call. Mirrors `th_client.py`'s existing 401 retry.
- **Proactive (optional).** On MCP token refresh, `tokenExchangeCallback` can
  re-login with the stored credentials and refresh `session_id` in `props` so the
  in-flight session rarely hits a cold 401.

```ts
tokenExchangeCallback: async ({ grantType, props, userId }) => {
  if (grantType !== "refresh_token") return;
  const creds = await loadDecryptedCreds(env, userId);      // from D1
  if (!creds) throw new OAuthError("invalid_grant", { description: "no stored creds; re-auth" });
  const th = await trainHeroicLogin(creds.email, creds.password);
  const next = { ...props, session_id: th.session_id };
  return { accessTokenProps: next, newProps: next };
}
```

If a stored login starts failing (password changed, account disabled), surface it as
`invalid_grant` so Claude re-runs the browser login and the credential row is
refreshed. No background cron is required for the private case.

## Storage model

The OAuth machinery uses **KV** (`OAUTH_KV`), not D1. The `McpAgent` is a Durable
Object with its own per-connection SQLite. **D1 is for your application data** — the
warehouse the skill currently keeps in `~/.trainheroic/library.db`, now shared and
tenant-scoped.

### D1 schema (port of the local store)

Every table gains a `tenant` column (`org_id`, or `th_user_id` where org doesn't
apply) and keeps the existing `source` provenance flag. Zone rules carry over
verbatim from `references/data-warehouse.md`.

- **Reference zone** (`exercise`, `tag`, `exercise_tag`, `swap`): prune-to-match
  with the `PRUNE_FLOOR` guard and 7-day TTL. The stock library is identical across
  orgs; only custom exercises are org-specific. For a tiny tenant count, key the
  whole table by `org_id` and accept duplication. (Alternative: one shared global
  partition plus per-org customs — more code, only worth it at scale.) Replace
  SQLite FTS5 with a D1 `LIKE`/ranked query or a small in-Worker scorer; FTS5 is not
  available in D1.
- **Programming zone** (`program`, `program_session`, `block`, `prescribed_set`):
  accumulate-only, never pruned. Idempotent upsert + block/set rebuild per session.
- **Messaging zone** (`message_stream`, `message_comment`): accumulate-only, upsert
  by id, `is_author` and `parent_id` preserved, `reactions` as JSON.
- **`sync_state`** (`resource`, `scope_id`, `cursor`, `synced_at`, `generation`) and
  **`sync_meta`**: per-tenant incremental watermarks.
- **`account`** (new): `th_user_id`, `org_id`, `email`, `role`, `created_at`,
  `last_seen`. Enumerate/manage tenants independent of active tokens.
- **`credential`** (new, required by the revised decision): `th_user_id`,
  `email_enc`, `password_enc`, `iv`, `key_version`, `updated_at`. The email +
  password encrypted with AES-GCM via WebCrypto, key from a Worker secret
  (`CRED_ENC_KEY`). Re-login reads and decrypts this row. `key_version` allows key
  rotation.

D1 has no per-row encryption like props, so anything sensitive in D1 (the credential
row) is application-encrypted before insert. Never log decrypted credentials; decrypt
only in-memory at re-login time.

## Tool surface (full-parity port)

Each script becomes one or more MCP tools registered on the `McpAgent`. Annotate
every tool with MCP hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so
the host can gate appropriately.

| Source script | MCP tool(s) | Notes |
|---|---|---|
| `th_client.py` (core) | shared request layer (not a tool) | `fetch()` + `this.props` headers + 401/403 retry. Underpins everything. |
| `th_client.py request` | `th_request` (escape hatch) | Raw `method/path/body`, `--auth api-token` flag. Mark non-read calls `destructiveHint`. |
| `th_client.py whoami` | `whoami` | Confirms auth, returns coach id / org_id / roles. |
| `library_cache.py resolve/search/get` | `exercise_resolve`, `exercise_search`, `exercise_get` | D1-backed. `resolve` returns candidates on ambiguity. |
| `library_cache.py sync` | `exercise_sync` | Refresh mirror; prune-to-match with floor. |
| `library_cache.py create` | `exercise_create` | API create + D1 write-through. Org-scoped. |
| `library_cache.py forget` | `exercise_forget` | Cache-only delete; run after an API delete. |
| `library_cache.py stats/cursors` | `store_stats` | Row counts + watermarks. |
| `programming_sync.py` | `programming_sync` | Walk calendars month-by-month into the programming zone. |
| `messaging_sync.py` | `messaging_sync` | Incremental per-stream cursor; `--full` re-pull. |
| `message_send.py streams/read` | `messaging_streams`, `messaging_read` | Read-only. |
| `message_send.py draft` | `message_draft` | Preview only, never sends. `readOnlyHint`. |
| `message_send.py send` | `message_send` | Athlete-facing, immediate. `destructiveHint`. Full body incl. `feed_id`. |
| `message_send.py delete` | `message_delete` | Soft delete. `destructiveHint`. |
| `build_workout.py` | `workout_build` | Program → session → blocks → exercises → publish. Fills all `param_*_data_N` slots, encodes prescriptions, supersets, leaderboards. |
| `build_workout.py --read` | `workout_read` | Read a built session back to verify. |
| (athletes/teams/programs/analytics) | thin typed tools or via `th_request` | e.g. `athletes_list`, `team_create`, `program_get`, `analytics_*`. |

### Destructive-action policy in MCP form

The skill's policy (warn, require explicit in-the-moment go-ahead, offer self-serve)
maps onto the tool layer, since there is no CLI prompt to gate on:

- Split preview from action: `message_draft` vs `message_send`, `workout_build
  --no-publish` (a draft) vs publish. Draft tools return the exact payload + a
  read-back for the user to approve.
- Mark every write/delete/publish/send tool `destructiveHint: true`,
  `readOnlyHint: false`. Hosts surface this for confirmation.
- Consider a two-step confirm: the draft tool returns a short-lived confirmation
  token (stored in the DO) that the destructive tool must echo back, so a publish
  cannot fire without a preceding preview.
- Keep the warnings in tool descriptions and in returned text so Claude relays them.

This satisfies the existing destructive-actions policy without the CLI's
in-the-moment gate.

## The port itself (Python → TypeScript)

The API knowledge in `references/` carries over unchanged; the code is a rewrite.

- `urllib` → `fetch`. The Workers runtime has no `urllib`, no disk, no per-user env.
- `~/.trainheroic/session.json` → `this.props`. Session lives in the encrypted grant,
  not on disk.
- `~/.trainheroic/library.db` (SQLite) → D1, tenant-scoped, FTS5 replaced.
- Per-process env creds → per-request `this.props`. Each connection is one tenant.
- Closest reference: Cloudflare's
  [`remote-mcp-github-oauth`](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth)
  demo (same `workers-oauth-provider` + `agents/mcp` pairing). The only structural
  difference is the upstream login is a password form, not a GitHub redirect.

## Project layout & config

```
worker/
  src/
    index.ts            # OAuthProvider wiring
    auth/
      handler.ts        # /authorize login form + completeAuthorization
      trainheroic.ts    # login + refresh against apis.trainheroic.com/auth
    mcp/
      agent.ts          # McpAgent subclass, registers all tools
      client.ts         # shared TH request layer (was th_client.py)
      tools/            # one module per tool group
    store/
      schema.sql        # D1 migrations
      exercises.ts      # was library_cache.py
      programming.ts    # was programming_sync.py
      messaging.ts      # was messaging_sync.py
  wrangler.jsonc
  migrations/
```

`wrangler.jsonc` bindings: `OAUTH_KV` (KV), `TH_DB` (D1), the `McpAgent` Durable
Object, and a `scheduled` handler calling `oauthProvider.purgeExpiredData` on a cron
trigger. Secrets: `COOKIE_ENCRYPTION_KEY` (for consent/state cookies),
`ALLOWED_EMAILS` (optional allowlist). No TrainHeroic secret — credentials are
per-user from the login form.

## Phased delivery

- **Phase 0 — Spike (gate).** Confirm TH refresh-token endpoint works. Stand up a
  hello-world remote MCP with `workers-oauth-provider` + a mock login, connect from
  Claude / MCP Inspector / Workers AI Playground. Decide credential model finally
  based on the refresh finding.
- **Phase 1 — Real auth.** TH login form, validate against `/auth`,
  `completeAuthorization` with props, `tokenExchangeCallback` refresh, allowlist.
  Port the shared client layer reading from `this.props`. Ship `whoami`.
- **Phase 2 — Reads.** Exercise resolve/search/get backed by D1 + the mirror sync;
  athletes/teams/programs/sessions/analytics reads; the `th_request` escape hatch.
- **Phase 3 — Writes.** `exercise_create` (write-through), `workout_build` /
  `workout_read` with the full field-filling and leaderboard/superset logic, draft
  vs publish split and destructive hints.
- **Phase 4 — Warehouse syncs.** D1 schema + migrations; `programming_sync`,
  `messaging_sync`, library sync with prune-to-match. Cron for `purgeExpiredData`.
- **Phase 5 — Messaging send + hardening.** Draft-gated `message_send` /
  `message_delete`, two-step confirm tokens, rate limiting, observability/logs,
  docs.

## Open questions / risks

1. **TH refresh endpoint** — RESOLVED in Phase 0: none exists. Renewal is re-login
   with stored credentials. (Credential decision revised.)
2. **`api-token` vs `session-token`** — Phase 0 showed `session-token` works on both
   hosts for `/user`. Confirm it covers every endpoint the skill currently sends
   `api-token` for; if so, drop the dual-header logic in the client layer.
3. **Exercise library sharing** — per-org duplication (simple) vs shared global +
   org customs (efficient). Recommend per-org for a private deployment.
3. **D1 search** — no FTS5. Confirm `LIKE` + a ranking heuristic is good enough for
   `exercise_search`, or precompute a normalized search column.
4. **TH rate limits / blocking** — a hosted Worker hits TH from Cloudflare egress IPs
   rather than a coach's machine. Watch for IP-based throttling or bot defenses on
   `apis.trainheroic.com`.
5. **Terms of service** — TH's API is undocumented; hosting a
   multi-tenant service against it carries more exposure than a personal script.
6. **Keeping the skill** — decide whether the Python skill stays as the local/dev
   path while the Worker serves remote, or the Worker fully replaces it.
```
