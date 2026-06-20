# TrainHeroic MCP — TypeScript Build Plan

> **Authoritative API/spec reference: `docs/mcp-spec-grounding.md`** (built from the live
> MCP `2025-11-25` spec + current SDK source). Where this plan and the grounding doc
> differ, the grounding doc wins. Key supersedes: credentials live in the OAuth grant's
> end-to-end-encrypted `props` (no D1 credential table / AES key); the destructive gate
> is MCP **elicitation** in-handler (annotations are advisory only); PKCE is S256-only
> (`allowPlainPKCE:false`); tool failures return as `isError:true` results, not JSON-RPC
> errors. D1 holds only the warehouse zones.

Execution plan for the server described in `cloudflare-mcp-plan.md` (architecture and
decisions). That doc is the "what/why"; this is the "how to build it." Decisions
carried in: TypeScript, private tenancy, encrypted password + re-login (no TH refresh
token exists), full skill parity.

## Toolchain (versions pinned from the registry on 2026-06-19)

Re-run `npm view <pkg> version` at scaffold time and pin the latest; do not trust
these numbers if much time has passed.

| Package | Version | Role |
|---|---|---|
| `@cloudflare/workers-oauth-provider` | 0.8.1 | OAuth 2.1 server wrapping the Worker |
| `agents` | 0.16.2 | `McpAgent` + transports |
| `@modelcontextprotocol/sdk` | 1.29.0 | `McpServer`, tool/resource defs |
| `wrangler` | 4.103.0 | dev/deploy/types/D1/KV |
| `typescript` | 6.0.3 | strict types |
| `vitest` | 4.1.9 | tests |
| `@cloudflare/vitest-pool-workers` | 0.16.18 | run tests in workerd |
| `oxlint` | 1.70.0 | lint |
| `oxfmt` | 0.55.0 | format |
| `zod` | 4.4.3 | tool input schemas (see compat note) |
| `hono` | 4.12.26 | optional routing for the login UI |
| `pnpm` | 11.8.0 | package manager |

Use `wrangler types` to generate `worker-configuration.d.ts` rather than depending on
`@cloudflare/workers-types`.

### Verify at scaffold (don't assume)

- **zod ↔ MCP SDK compat.** The MCP SDK has historically tracked zod 3. Confirm
  `@modelcontextprotocol/sdk@1.29` accepts zod 4 schemas in `server.tool(...)`; if
  not, pin the zod major the SDK declares as a peer.
- **oxfmt config.** It's at 0.55.0 and young. Confirm its config file name and flags
  (and that oxlint defers formatting to it) before wiring CI.
- **compatibility_date / flags.** Set `compatibility_date` to today and confirm the
  Agents SDK's required flags (expect `nodejs_compat`).

## Repository layout

Add the Worker as its own pnpm project under `worker/`, leaving the Python skill in
place as the local/dev path.

```
worker/
  package.json
  pnpm-lock.yaml
  wrangler.jsonc
  tsconfig.json
  .oxlintrc.json
  vitest.config.ts
  .dev.vars            # local secrets, gitignored
  migrations/
    0001_init.sql
  src/
    index.ts           # OAuthProvider wiring (default export)
    env.ts             # Env typing helpers
    auth/
      handler.ts       # /authorize login form + completeAuthorization + allowlist
      trainheroic.ts   # login() against apis.trainheroic.com/auth
      crypto.ts        # AES-GCM encrypt/decrypt for the credential row
      callback.ts      # tokenExchangeCallback (re-login on MCP token refresh)
    mcp/
      agent.ts         # McpAgent<Env, State, Props>; registers tools
      client.ts        # shared TH request layer + 401 re-login (was th_client.py)
      confirm.ts       # two-step confirm-token store for destructive tools
      tools/
        reads.ts       # whoami, athletes, teams, programs, sessions, analytics
        exercises.ts   # resolve/search/get/sync/create/forget (D1-backed)
        workout.ts     # build/read (port of build_workout.py)
        messaging.ts   # streams/read/draft/send/delete + sync
        programming.ts # programming_sync
        raw.ts         # th_request escape hatch
    store/
      d1.ts            # query helpers, tenant scoping
      exercises.ts     # reference zone (prune-to-match + TTL)
      programming.ts   # programming zone (accumulate-only)
      messaging.ts     # messaging zone (accumulate-only)
      sync_state.ts    # watermarks
```

## wrangler.jsonc (shape)

```jsonc
{
  "name": "trainheroic-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-19",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "durable_objects": {
    "bindings": [{ "name": "MCP_AGENT", "class_name": "TrainHeroicMCP" }]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["TrainHeroicMCP"] }
  ],
  "kv_namespaces": [
    { "binding": "OAUTH_KV", "id": "<created via wrangler kv namespace create>" }
  ],
  "d1_databases": [
    { "binding": "TH_DB", "database_name": "trainheroic", "database_id": "<created>" }
  ],
  "triggers": { "crons": ["0 4 * * *"] }   // purgeExpiredData; optional periodic sync
}
```

Secrets (via `wrangler secret put`, and `.dev.vars` locally):
`CRED_ENC_KEY` (base64 32-byte AES key), `COOKIE_ENCRYPTION_KEY` (consent/state
cookies), `ALLOWED_EMAILS` (comma-separated allowlist). No TrainHeroic secret;
credentials are per-user from the login form.

## Config files

- **tsconfig.json**: `"strict": true`, plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`,
  `module`/`moduleResolution` per the Workers preset, `types` pointing at the
  generated `worker-configuration.d.ts`.
- **.oxlintrc.json**: enable `correctness`, `suspicious`, and `pedantic` categories;
  treat warnings as errors in CI. Let oxfmt own formatting.
- **vitest.config.ts**: use `defineWorkersConfig` from `@cloudflare/vitest-pool-workers`
  with the same `wrangler.jsonc` so tests get real D1/KV/DO bindings.
- **package.json scripts**: `dev` (`wrangler dev`), `deploy`, `typecheck`
  (`tsc --noEmit`), `lint` (`oxlint`), `fmt` (`oxfmt`), `test` (`vitest`),
  `cf-typegen` (`wrangler types`), `db:migrate` / `db:migrate:local`
  (`wrangler d1 migrations apply trainheroic`).

## index.ts (entry shape)

```ts
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { TrainHeroicMCP } from "./mcp/agent";
import { authHandler } from "./auth/handler";
import { tokenExchangeCallback } from "./auth/callback";

export { TrainHeroicMCP }; // Durable Object export

export default new OAuthProvider({
  apiHandlers: {
    "/mcp": TrainHeroicMCP.serve("/mcp"),     // Streamable HTTP
    "/sse": TrainHeroicMCP.serveSSE("/sse"),  // legacy SSE
  },
  defaultHandler: authHandler,                // renders /authorize login form
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  tokenExchangeCallback,
  scopesSupported: ["coach"],
});
```

`scheduled` handler calls `oauthProvider.purgeExpiredData(env, ...)` for KV hygiene.

## Credential encryption (`auth/crypto.ts`)

WebCrypto AES-GCM. Import the base64 `CRED_ENC_KEY` as an `AES-GCM` `CryptoKey`. On
write, generate a 12-byte IV per field, store `{ciphertext, iv}` base64 in the
`credential` row alongside `key_version`. On re-login, decrypt in memory only; never
log plaintext. `key_version` lets a future key rotation re-encrypt rows.

## D1 schema (`migrations/0001_init.sql`)

Port the three zones from `references/data-warehouse.md`, each tenant-scoped, plus the
accounts and credential tables. Highlights:

- `account(th_user_id PK, org_id, email, role, created_at, last_seen)`
- `credential(th_user_id PK, email_enc, email_iv, password_enc, password_iv, key_version, updated_at)`
- Reference zone `exercise`, `tag`, `exercise_tag`, `swap` keyed by `org_id`;
  prune-to-match with the `PRUNE_FLOOR` guard; 7-day TTL via `sync_meta`.
  Replace FTS5 with a normalized `search_text` column + `LIKE`/ranking, since D1 has
  no FTS5.
- Programming zone `program`, `program_session`, `block`, `prescribed_set`
  (accumulate-only) keyed by `org_id`.
- Messaging zone `message_stream`, `message_comment` (accumulate-only).
- `sync_state(resource, scope_id, cursor, synced_at, generation, PRIMARY KEY(resource, scope_id))`
  and `sync_meta`. Every records table keeps `source` (default `'api'`).

## Shared client + re-login (`mcp/client.ts`)

The port of `th_client.py`'s request layer. Reads `session_id` from `this.props`,
sends the `session-token` header (Phase 0 showed it works on both hosts; keep an
`api-token` fallback only if a later endpoint needs it). On 401/403: load + decrypt
the `credential` row, re-POST to `/auth`, update the agent's in-memory `session_id`,
retry once. Mirrors the existing skill behavior; the difference is the credential
source (D1, not env) and `fetch` instead of `urllib`.

## Tools (`mcp/agent.ts` + `tools/`)

`McpAgent<Env, State, Props>` with `Props = { th_user_id; org_id; session_id; role }`.
Register every tool from the parity table in `cloudflare-mcp-plan.md`. Apply MCP
annotations: `readOnlyHint` on reads, `destructiveHint` on send/publish/delete.

Destructive gating (maps the skill's policy): draft/preview tools (`message_draft`,
`workout_build` with publish=false) return the exact payload plus a short-lived
confirm token stored in the DO (`confirm.ts`), keyed by a hash of the action. The
matching destructive tool (`message_send`, publish, `*_delete`) requires that token,
so nothing athlete-facing fires without a preceding preview. Tool descriptions carry
the warning text so the host relays it.

The highest-value port is `workout.ts`: the `param_*_data_N` slot filling, prescription
encoding, superset detection, leaderboard/Red-Zone encoding, and the unit-coercion
gotchas. Keep this as pure functions so it is unit-testable without network.

## Testing

`@cloudflare/vitest-pool-workers` runs tests inside workerd with real bindings.

- **Pure logic (priority):** table-driven tests for the workout payload encoder
  (one case per gotcha: superset, leaderboard units, RPE-in-instruction, the
  all-ten-slots requirement). Port the known-good payloads from the skill as fixtures.
- **Crypto:** round-trip encrypt/decrypt, wrong-key failure, key_version handling.
- **Client re-login:** mock a 401 then 200, assert one re-login and one retry.
- **D1 stores:** prune-to-match floor, accumulate-only never deletes, sync_state
  watermark advance, idempotent re-sync.
- **Auth flow:** mock TH `/auth`, assert `completeAuthorization` props shape, allowlist
  rejection, and that the password lands only in the encrypted `credential` row.

## Local dev & connecting a client

1. `wrangler kv namespace create OAUTH_KV` and `wrangler d1 create trainheroic`; paste
   ids into `wrangler.jsonc`.
2. `wrangler d1 migrations apply trainheroic --local`; put dev secrets in `.dev.vars`.
3. `pnpm dev`, then connect MCP Inspector or the Workers AI Playground to
   `http://localhost:8787/mcp`, complete the TrainHeroic login, exercise a read tool.
4. Deploy: `wrangler d1 migrations apply trainheroic` (remote), `wrangler secret put`
   each secret, `wrangler deploy`, then add the `workers.dev` `/mcp` URL to Claude.

## Build sequence (maps to the architecture doc's phases)

1. **Scaffold** — pnpm project, configs, `wrangler.jsonc`, empty DO, `wrangler types`,
   green `lint`/`fmt`/`typecheck`/`test`. Deploy a hello tool behind OAuth with a mock
   login; connect Claude end to end.
2. **Auth** — login form, `trainheroic.ts`, `crypto.ts`, `credential` D1 table,
   `completeAuthorization`, `tokenExchangeCallback`, allowlist. Ship `whoami`.
3. **Client + reads** — `client.ts` with re-login; `reads.ts`; `raw.ts`.
4. **Exercises + D1 reference zone** — store + resolve/search/get/sync/create/forget.
5. **Workout builder** — `workout.ts` pure encoder + tools, draft/confirm gating.
6. **Warehouse syncs** — programming + messaging zones and their sync tools; cron.
7. **Messaging send + hardening** — draft-gated send/delete, rate limiting,
   observability, docs.

## Risks

- **zod/MCP-SDK version friction** (verify at scaffold; pin if needed).
- **TH egress throttling** — the Worker calls TH from Cloudflare IPs, not a coach's
  machine; watch for IP-based rate limits or bot defenses on `apis.trainheroic.com`.
- **`api-token` assumption** — confirm `session-token` covers every endpoint before
  dropping the dual-header path.
- **Undocumented API drift** — TH is reverse-engineered; keep `references/` as the
  contract and fail loudly on shape changes.
```
