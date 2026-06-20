# MCP Spec Grounding — Remote MCP Server on Cloudflare (TrainHeroic API)

Grounding document for building a remote MCP server on Cloudflare Workers (TypeScript) that wraps the TrainHeroic API using `@cloudflare/workers-oauth-provider`, the Agents SDK `McpAgent`, D1, KV, and a self-handled username/password login that stores encrypted credentials.

Verified package versions: `@cloudflare/workers-oauth-provider@0.8.1` (gitHead `f8e3ddd5`), `agents@0.16.2` (`McpAgent` from `agents/mcp`), MCP TS SDK `@modelcontextprotocol/sdk` ≥ 1.26.0 (1.28.0 in agents 0.8.6+).

---

## 1. Latest MCP spec revision in scope

**`2025-11-25`** is the current (published) MCP protocol revision. Versions are `YYYY-MM-DD` strings marking the last date backwards-incompatible changes were made; the version is not bumped for backwards-compatible changes. [Source: spec-transport, modelcontextprotocol.io/specification/versioning — "The current protocol version is 2025-11-25".]

- Prior revisions: `2025-06-18`, `2025-03-26` (introduced Streamable HTTP), `2024-11-05` (deprecated HTTP+SSE).
- Default JSON Schema dialect as of this revision is **JSON Schema 2020-12** (SEP-1613). [Source: spec-tools, spec-elicitation]
- A release candidate (`2026-07-28`, locking `2026-05-21`) exists but is **not yet published**; it removes protocol-level sessions and the `Mcp-Session-Id` header (SEP-2567) and the `initialize`/`initialized` handshake (SEP-2575). We build to `2025-11-25` and treat session-binding code as RC-deprecated. [Source: spec-security]

We will send/honor `MCP-Protocol-Version: 2025-11-25`.

---

## 2. SPEC COMPLIANCE CHECKLIST

Each item is phrased as something our server MUST/SHOULD do. RFC-2119 keywords are load-bearing.

### 2A. Transport (Streamable HTTP, single endpoint)

- [ ] Expose a single MCP endpoint path (e.g. `/mcp`) that supports **both POST and GET**. [spec-transport]
- [ ] On POST, accept `Accept: application/json, text/event-stream` (both listed); reply with either `Content-Type: application/json` (one JSON object) or `Content-Type: text/event-stream` (open SSE). [spec-transport]
- [ ] When the POST body is a *response* or *notification*: on success return **HTTP 202 Accepted** with no body. [spec-transport]
- [ ] On GET, accept `Accept: text/event-stream` to open a server→client SSE stream, OR return **405 Method Not Allowed**. On a GET stream, do not send a JSON-RPC *response* unless resuming a prior stream. [spec-transport]
- [ ] Validate the `Origin` header on all requests; if `Origin` is present and invalid, return **403 Forbidden** (DNS-rebinding defense; new MUST in 2025-11-25, PR #1439). [spec-transport]
- [ ] Require `MCP-Protocol-Version` on all post-initialization requests; if absent and version cannot otherwise be determined, assume `2025-03-26`; if invalid/unsupported, return **400 Bad Request**. [spec-transport]
- [ ] If we assign a session, return `MCP-Session-Id` on the response carrying `InitializeResult`; require it on every subsequent request (else **400**); return **404** for a terminated session ID; accept **DELETE** with `MCP-Session-Id` to end a session (MAY reject with 405). Emit the `MCP-Session-Id` casing (cosmetic vs the old `Mcp-Session-Id`). [spec-transport]
- [ ] Support resumability: attach SSE `id` fields (globally unique within session), honor `Last-Event-ID` via GET, replay only on the same stream, never broadcast one JSON-RPC message across multiple streams. [spec-transport]
- [ ] (SHOULD) Support pollable SSE (SEP-1699): prime reconnect with an empty-`data` event carrying an `id`; send a standard SSE `retry` field before closing a connection. [spec-transport]
- [ ] Implement the three-phase lifecycle: `initialize` request/result, then client `notifications/initialized`; before `initialize` responds the server sends nothing but `ping`/logging. [spec-transport]
- [ ] Echo the client's `protocolVersion` if supported, else return our latest; on mismatch surface JSON-RPC `-32602` "Unsupported protocol version" with `data.supported`/`data.requested`. [spec-transport]
- [ ] (Optional back-compat) Run `serveSSE("/sse")` alongside `serve("/mcp")` for legacy 2024-11-05 SSE clients. The SDK and `transport: "auto"` (agents 0.8.7) can serve both on one endpoint. [spec-transport, cf-mcpagent]

> The `McpAgent.serve()` / `createMcpHandler` path implements the POST/GET behavior, 202/400/404/405 codes, and `Accept` handling for us. Do not hand-roll the transport unless using the raw `WebStandardStreamableHTTPServerTransport`. [spec-transport]

### 2B. Authorization (OAuth 2.1 resource server)

- [ ] Act as an **OAuth 2.1 resource server**; authorization applies only to HTTP transport (not STDIO). [spec-authorization]
- [ ] Implement **RFC 9728 Protected Resource Metadata**, served at `/.well-known/oauth-protected-resource` (root and/or path-scoped `/.well-known/oauth-protected-resource/mcp`); the document MUST include `authorization_servers` with ≥1 AS. (The library serves this automatically.) [spec-authorization, cf-oauth-provider]
- [ ] Provide **at least one** of RFC 8414 AS Metadata or OpenID Connect Discovery 1.0 at `/.well-known/oauth-authorization-server`. (Library serves this from `authorizeEndpoint`/`tokenEndpoint`.) [spec-authorization, cf-oauth-provider]
- [ ] On a 401, MAY send `WWW-Authenticate: Bearer resource_metadata="…"` and SHOULD include `scope="…"` (RFC 6750 §3). [spec-authorization]
- [ ] Require PKCE; advertise and accept **S256 only** by setting `allowPlainPKCE: false`; advertise `code_challenge_methods_supported`. [spec-authorization, cf-oauth-provider]
- [ ] Validate every inbound bearer token per OAuth 2.1 §5.2 (signature/issuer/`exp`/`nbf`). [spec-security]
- [ ] Validate the token **audience** is our canonical MCP URI (RFC 8707 §2 / RFC 9068 `aud`); reject tokens not issued for us. Set `resourceMetadata.resource` to the canonical URI (no fragment, prefer no trailing slash, e.g. `https://mcp.example.com/mcp`). [spec-authorization, spec-security]
- [ ] Accept the bearer token only from `Authorization: Bearer <token>` on **every** request; reject tokens in the URI query string. [spec-security]
- [ ] On invalid/expired token return **401**; on insufficient scope return **403** with `WWW-Authenticate: Bearer error="insufficient_scope", scope="…", resource_metadata="…"`; on malformed auth request return **400**. [spec-security]
- [ ] **Never pass through** the client's MCP token to the TrainHeroic API. The TrainHeroic credential is a separate secret minted/held by us; the inbound MCP token MUST be structurally incapable of leaking upstream. [spec-security]
- [ ] Serve all AS endpoints over HTTPS; validate redirect URIs by **exact** match (no wildcards); redirect URIs MUST be `localhost` or HTTPS. [spec-authorization]
- [ ] Keep `scopes_supported` minimal (least-privilege baseline); do step-up via 403 + `WWW-Authenticate` scope challenge rather than requesting broad scopes up front; never publish wildcard scopes. [spec-security]
- [ ] In our self-handled `/authorize` consent UI: render per-client consent naming the client (from `lookupClient`) and its `redirect_uri`; set CSP `frame-ancestors 'none'` and `X-Frame-Options: DENY`; use `__Host-`-prefixed `Secure`/`HttpOnly`/`SameSite=Lax` cookies; use a single-use, short-TTL (~10 min) `state` set only after consent; CSRF-protect the form. [spec-security, cf-reference-and-d1]
- [ ] Treat session IDs as **non-authenticating**: re-validate the bearer token on every request, never grant access on session-ID presence. Generate session IDs with a CSPRNG; bind session-scoped/queued data as `<user_id>:<session_id>` where `user_id` is derived from the validated token, not client-supplied. [spec-security]
- [ ] If we ever fetch OAuth-discovery URLs (acting as MCP client), apply SSRF protection: HTTPS only (except loopback in dev), block RFC 1918 / loopback / link-local / `169.254.169.254` / IPv6 ULA. The agents SDK ≥0.7.0 does this for the MCP client; `clientIdMetadataDocumentEnabled` requires the `global_fetch_strictly_public` compat flag. [spec-security, cf-mcpagent, cf-oauth-provider]

### 2C. Tools & annotations

- [ ] Declare the `tools` capability: `{ "capabilities": { "tools": { "listChanged": true } } }`; emit `notifications/tools/list_changed` when the tool set changes. [spec-tools]
- [ ] Give each tool a `name` (1–128 chars, `[A-Za-z0-9_.-]`, case-sensitive, unique) and a required `inputSchema` of `type: "object"` (defaults to JSON Schema 2020-12). [spec-tools]
- [ ] If a tool declares `outputSchema` (root `type: "object"`), the server MUST return `structuredContent` conforming to it, AND SHOULD also return the serialized JSON as a `TextContent` block in `content` for non-structured-aware clients. [spec-tools]
- [ ] Report tool-execution failures (TrainHeroic API errors, validation, business-logic) **inside the result** with `isError: true` and a normal result — NOT as a JSON-RPC error — so the LLM can self-correct. Reserve JSON-RPC errors (`-32602` etc.) for protocol errors (unknown tool, malformed request). [spec-tools]
- [ ] Set tool annotations honestly: `readOnlyHint` (default false), `destructiveHint` (default **true**; meaningful only when `readOnlyHint==false`), `idempotentHint` (default false), `openWorldHint` (default true). Mark TrainHeroic read tools `readOnlyHint: true`; mark delete/publish/unpublish tools `destructiveHint: true`. [spec-tools]
- [ ] Treat annotations as advisory UI/UX hints only; do not base security decisions on annotations from untrusted servers. Our own annotations gate UX, not server-side authorization — the destructive gate must be enforced server-side (see elicitation). [spec-tools]
- [ ] Support `tools/list` opaque cursor pagination: return `nextCursor` when more results exist; treat client cursors as opaque; return `-32602` on invalid cursor; do not assume a fixed page size. [spec-tools]
- [ ] (Optional, experimental) `Tool.execution.taskSupport` (`forbidden`/`optional`/`required`) and `tools/call` `task` for durable long-running calls (SEP-1686) — relevant only if we adopt task-augmented execution for long syncs. [spec-tools]

### 2D. Security (cross-cutting)

- [ ] **Audience validation** on every request (see 2B); reject any token whose `aud` does not include us. [spec-security]
- [ ] **No token passthrough**: never accept tokens not issued for us; never forward the inbound token to TrainHeroic. Keep inbound (audience = us) and outbound (TrainHeroic creds) token contexts physically separate in code. [spec-security]
- [ ] **Confused-deputy**: only relevant if we proxy a third-party OAuth AS. Since we self-issue tokens and self-handle login, the full attack class largely does not apply, but per-client consent + exact-redirect + one-time `state` discipline still hold for our own `/authorize` + `/callback`. [spec-security]
- [ ] **Session hijacking**: non-deterministic session IDs, token re-validation per request, `<user_id>:<session_id>` keying for resumable/queued state, re-check resuming user matches bound user before replaying SSE. [spec-security]
- [ ] **Consent / scope minimization**: minimal `scopes_supported`, step-up via 403, no omnibus scopes, server-side enforcement of scope per operation. [spec-security]
- [ ] **Logging**: never log credentials/secrets/PII or TrainHeroic athlete personal data; scrub names/emails from `notifications/message` payloads (RFC 5424 levels). [spec-elicitation]
- [ ] **Destructive-action gate**: use `elicitation/create` (form mode) to require explicit confirmation before delete/publish/unpublish, only proceeding on `action: "accept"`; treat `decline`/`cancel` as abort. Bind elicitation state to verified user identity (the token's `sub`/`userId`), not session ID alone. Form mode MUST NOT request secrets — credentials use URL mode. [spec-elicitation]

---

## 3. Exact API signatures we will call

### 3A. `OAuthProvider` constructor (workers-oauth-provider 0.8.1)

The class is the Worker entrypoint (implements `fetch()`; supports `scheduled()` via `purgeExpiredData`). Export `export default new OAuthProvider({...})` directly, or wrap `oauthProvider.fetch(...)` when also exporting `scheduled`. [Source: cf-oauth-provider, verbatim from `src/oauth-provider.ts` @ v0.8.1]

```ts
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

export default new OAuthProvider({
  // EITHER single-handler: apiRoute + apiHandler ...
  apiRoute: "/mcp",                       // string | string[]; path matches any host, full URL matches host
  apiHandler: MyMCP.serve("/mcp"),        // ExportedHandler | WorkerEntrypoint ctor
  // ... OR multi-handler (NOT both): apiHandlers
  // apiHandlers: { "/mcp": MyMCP.serve("/mcp"), "/sse": MyMCP.serveSSE("/sse") },

  defaultHandler: AuthHandler,            // REQUIRED: our /authorize UI + non-API routes
  authorizeEndpoint: "/authorize",        // NOT implemented by lib (our app renders it)
  tokenEndpoint: "/token",                // implemented by lib
  clientRegistrationEndpoint: "/register",// optional: enables RFC 7591 DCR

  scopesSupported: ["mcp:tools-basic"],   // -> scopes_supported in RFC 8414 metadata
  allowImplicitFlow: false,               // default false
  allowPlainPKCE: false,                  // SET FALSE -> S256-only (default is TRUE for back-compat)
  disallowPublicClientRegistration: false,
  accessTokenTTL: 3600,                   // default 1h
  refreshTokenTTL: 2592000,               // default 30d; 0 disables refresh; undefined = never expire
  clientRegistrationTTL: 7776000,         // default 90d
  allowTokenExchangeGrant: false,         // RFC 8693
  clientIdMetadataDocumentEnabled: false, // true requires global_fetch_strictly_public compat flag
  resourceMatchOriginOnly: false,
  resourceMetadata: {                     // RFC 9728 PRM customization
    resource: "https://mcp.example.com/mcp",
    authorization_servers: ["https://mcp.example.com"],
    scopes_supported: ["mcp:tools-basic"],
    bearer_methods_supported: ["header"],
    resource_name: "TrainHeroic MCP",
  },
  tokenExchangeCallback,                  // see 3C
  // onError, clientRegistrationCallback, resolveExternalToken, enterpriseManagedAuthorization
});
```

Rule: use **either** `apiRoute` + `apiHandler` **or** `apiHandlers`, never both. `defaultHandler` is always required. [cf-oauth-provider]

### 3B. `env.OAUTH_PROVIDER` helpers (`OAuthHelpers`) — the `/authorize` loop

```ts
// in defaultHandler at GET /authorize
const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
// -> AuthRequest { responseType, clientId, redirectUri, scope: string[], state,
//                  codeChallenge?, codeChallengeMethod?, resource?: string | string[] }

const client = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
// -> ClientInfo | null { clientId, redirectUris, clientName?, logoUri?, tokenEndpointAuthMethod, ... }

// ... we authenticate the user (TrainHeroic username/password) + render consent ...

const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
  request: oauthReqInfo,          // REQUIRED (from parseAuthRequest)
  userId: thUserId,               // our user id; used for grant enumeration/revocation; NOT encrypted
  metadata: { label: thUsername },// opaque, NOT encrypted (audit/revocation UIs)
  scope: oauthReqInfo.scope,      // actually-granted scopes
  props: {                        // ENCRYPTED end-to-end with the token as key material
    userId: thUserId,
    username: thUsername,
    thCredsCiphertext: "<base64 iv||ciphertext>", // see CHANGES section
  },
  // revokeExistingGrants defaults true; revokeExistingGrantsBatchSize default 50 (max 1000)
});
return Response.redirect(redirectTo, 302);
```

`completeAuthorization` re-validates the redirect URI against the client's registered URIs server-side (open-redirect guard); tampering with `request` cannot bypass it. By default it revokes prior grants for the same user+client (prevents stale `props`). [cf-oauth-provider]

Other `OAuthHelpers` we may use: `createClient`, `listClients`, `updateClient`, `deleteClient` (cascades — revokes that client's grants/tokens), `listUserGrants(userId, opts?)`, `revokeGrant(grantId, userId)` (both IDs required), `unwrapToken<T>(token)`, `exchangeToken(opts)`, `purgeExpiredData(opts?)`. [cf-oauth-provider]

### 3C. `tokenExchangeCallback`

Used to mint/refresh upstream tokens and stash them in `props` (spec-compliant separation from the MCP token). For TrainHeroic, this is where we would refresh a TrainHeroic session token on `refresh_token` grants if we choose token-lifecycle rotation rather than re-login.

```ts
async function tokenExchangeCallback(opts: TokenExchangeCallbackOptions) {
  // opts: { grantType: 'authorization_code' | 'refresh_token', clientId, userId,
  //         grantId, scope: string[], requestedScope: string[], props: any }
  // return TokenExchangeCallbackResult | void:
  return {
    accessTokenProps,   // props only on the access token
    newProps,           // updates grant + (by default) access token
    accessTokenTTL,
    refreshTokenTTL,
    accessTokenScope,
  };
}
```

Throw `OAuthError(code, { description, statusCode?, headers? })` here to surface a structured `/token` error instead of a 500. `code` is one of the canonical `OAuthTokenErrorCode` values (`invalid_grant`, `invalid_client`, `insufficient_scope`, ...). Only the exact `OAuthError` class from the package is converted; plain `Error`s fall through to 500. [cf-oauth-provider]

### 3D. `McpAgent` — `serve`/`serveSSE`, `this.props`, `init`, elicitation (agents 0.16.2)

```ts
import { McpAgent } from "agents/mcp";                       // NOT the package root
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type State = { /* persisted, DO SQLite-backed */ };
type Props = { userId: string; username: string; thCredsCiphertext: string };

export class MyMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({ name: "TrainHeroic", version: "1.0.0" }); // per-instance field, NOT global
  initialState: State = { /* ... */ };

  async init() {
    // full access to this.props, this.state, this.sql, this.setState here
    // register tools conditionally on this.props if needed
    this.server.registerTool(
      "th_delete_team",
      { description: "Delete a team", inputSchema: { teamId: z.string() } },
      async (args, extra) => {
        // destructive gate via elicitation:
        const confirm = await this.server.server.elicitInput(
          {
            message: `This will permanently delete team ${args.teamId}. Confirm?`,
            requestedSchema: {
              type: "object",
              properties: { confirm: { type: "boolean", title: "Confirm deletion" } },
              required: ["confirm"],
            },
          },
          { relatedRequestId: extra.requestId },
        );
        if (confirm.action !== "accept" || !confirm.content?.confirm) {
          return { content: [{ type: "text", text: "Cancelled." }] };
        }
        // ... proceed, decrypting this.props.thCredsCiphertext to call TrainHeroic ...
      },
    );
  }
}

// Static handler factories (return a Worker fetch handler):
MyMCP.serve("/mcp");                              // Streamable HTTP
MyMCP.serve("/mcp", { binding: "MCP_OBJECT" });  // options: binding, jurisdiction ("eu"|"fedramp")
MyMCP.serve("/mcp", { transport: "auto" });      // agents 0.8.7+: streamable-http + legacy SSE on one path
MyMCP.serveSSE("/sse");                           // legacy SSE (was McpAgent.mount; alias kept)
```

- `this.props` is typed by the third generic, populated from the OAuth grant's `props` (delivered via `getAgentByName → onStart`, restored from storage on hibernation). Read it in `init()` and tool handlers. [cf-mcpagent]
- `McpServer` MUST be a per-instance field, never module/global scope (MCP SDK ≥1.26.0 guard throws on connecting an already-connected server; CVE fix). [cf-mcpagent]
- `agents` ≥0.8.0 requires `zod ^4.0.0`. [cf-mcpagent]
- Elicitation: `this.server.server.elicitInput(options, { relatedRequestId: extra.requestId })` returns `{ action: "accept" | "decline", content? }`. The CF wrapper does NOT surface the spec's `"cancel"` action — treat any non-`"accept"` as abort. [cf-mcpagent]
- Stateless path alternative: `createMcpHandler(server)(request, env, ctx)` with `getMcpAuthContext()` (AsyncLocalStorage) instead of `this.props`. [spec-transport, cf-mcpagent]

### 3E. D1 + AES-GCM (credential storage)

```ts
// D1 binding API
db.prepare(sql).bind(...vals);          // ? or ?NNN placeholders; named (:name) NOT supported
await stmt.first(col?);                 // first row / single column value
await stmt.run();  await stmt.all();    // D1Result { success, results, meta{ changes, last_row_id, rows_read, ... } }
await db.batch([stmt1, stmt2]);         // ONE SQL transaction: all-or-nothing rollback; results array parallel to input
// limits: 100 bound params/query, 100KB statement, 2MB row, 1000 queries/invocation (Paid)

// AES-GCM for TrainHeroic creds (WebCrypto, no compat flag needed)
const key = await crypto.subtle.importKey("raw", rawKeyBytes, { name: "AES-GCM" }, false, ["encrypt","decrypt"]);
const iv = crypto.getRandomValues(new Uint8Array(12));           // 12 bytes, NEVER reuse with same key
const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
// store iv || ciphertext (base64); GCM auth tag (128-bit) is appended to ct by encrypt(), consumed by decrypt()
const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct); // throws OperationError on tag failure
```

[Source: cf-reference-and-d1]

---

## 4. Correct current `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "trainheroic-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-18",
  // Agents SDK REQUIRES nodejs_compat. Add global_fetch_strictly_public ONLY if CIMD is enabled.
  "compatibility_flags": ["nodejs_compat"],

  // McpAgent Durable Object (SQLite-backed). class_name must EXACTLY match the exported class.
  "durable_objects": {
    "bindings": [
      { "name": "MCP_OBJECT", "class_name": "MyMCP" }
    ]
  },

  // SQLite-backed DOs require new_sqlite_classes (NOT legacy new_classes).
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["MyMCP"] }
  ],

  // OAuth provider state. Binding name MUST be exactly OAUTH_KV.
  "kv_namespaces": [
    { "binding": "OAUTH_KV", "id": "<KV_ID>", "preview_id": "<KV_PREVIEW_ID>" }
  ],

  // D1 for encrypted TrainHeroic credentials + app data.
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "trainheroic-mcp",
      "database_id": "<D1_UUID>",
      "preview_database_id": "<D1_PREVIEW_UUID>",
      "migrations_dir": "migrations"
    }
  ],

  // Cron triggers -> scheduled(event, env, ctx). Cap of 5 per Worker. Used for purgeExpiredData.
  "triggers": {
    "crons": ["0 * * * *"]
  },

  "observability": { "enabled": true }
}
```

Key facts: [Source: cf-reference-and-d1, cf-mcpagent, cf-oauth-provider]

- **Durable Object bindings**: `name` (required), `class_name` (required, exact match to exported class). The demo uses `name: "MCP_OBJECT"`; pick a consistent binding name and reuse it in `serve("/mcp", { binding })`.
- **Migrations**: `tag` (unique), `new_sqlite_classes` (required for new SQLite DO classes — omitting it produces "No such Durable Object class"). Later: `renamed_classes`, `deleted_classes`.
- **KV**: binding MUST be `OAUTH_KV` (library reads `env.OAUTH_KV`); `id` required, `preview_id` optional for `wrangler dev`.
- **D1**: `binding`, `database_name`, `database_id` required; `preview_database_id` optional (required for `dev --remote`); `migrations_dir`/`migrations_pattern` optional.
- **Crons** live under `triggers.crons` (array of cron strings); handled by a `scheduled()` export calling `oauthProvider.purgeExpiredData(env, { batchSize: 100 })`.
- **`compatibility_flags`**: `nodejs_compat` required by the Agents SDK. Add `global_fetch_strictly_public` ONLY if `clientIdMetadataDocumentEnabled: true` (SSRF protection; the module warns at load if missing). WebCrypto AES-GCM needs NO compat flag.
- **Secrets** (`COOKIE_ENCRYPTION_KEY`, the AES creds key, any TrainHeroic app secrets): `.dev.vars` locally, `wrangler secret put` in prod. Never put secrets in `vars`. Add `.dev.vars*` / `.env*` to `.gitignore`.

---

## 5. CHANGES / SURPRISES vs the build plan

Against a plan that assumed: (a) `props` holds `session_id`; (b) AES-GCM creds in D1; (c) tool annotations for destructive gating; (d) `/mcp` + `/sse` via `apiHandlers`.

### 5.1 `props` should NOT hold a session_id as the auth anchor — SURPRISE / CHANGE
- The spec is explicit: servers **MUST NOT use sessions for authentication** and **MUST verify all inbound requests** by re-validating the bearer token; session IDs are non-authenticating. Binding auth to a `session_id` in `props` violates this. [spec-security]
- The library already gives us the right model: the **token** is the auth anchor, and `props` is end-to-end encrypted with the token as key material. So `props` is the correct place for the TrainHeroic credential, but it is keyed by the issued OAuth token, not by a session ID. [cf-oauth-provider]
- `userId` and `metadata` passed to `completeAuthorization` are **NOT encrypted** (they exist for grant enumeration/revocation). Do not put anything sensitive in `userId`/`metadata`. [cf-oauth-provider]
- Where session IDs do appear (the transport `MCP-Session-Id`), they must be CSPRNG-generated and any session-scoped queued/resumable state must be keyed `<user_id>:<session_id>` with `user_id` from the validated token. [spec-security]
- RC note: the 2026-07-28 RC removes protocol-level sessions entirely — another reason not to make `session_id` load-bearing. [spec-security]

### 5.2 AES-GCM creds in D1 — MOSTLY CONFIRMED, with a simpler option surfaced
- AES-GCM in D1 works: WebCrypto `crypto.subtle` AES-GCM, 12-byte random IV per message (never reused), 128-bit tag auto-appended, store `iv||ciphertext` base64. No compat flag. [cf-reference-and-d1]
- SURPRISE: `props` is **already** end-to-end encrypted (token-derived key) and explicitly documented as safe to hold secrets such as upstream tokens. So we have two viable stores for the TrainHeroic credential:
  1. **In `props`** (encrypted by the library, no D1 row, no separate key to manage). Simplest; the credential lives with the grant and is revoked when the grant is revoked.
  2. **In D1** with our own AES-GCM (decoupled from token lifetime; survives token rotation; queryable/auditable; but we own key management and rotation).
- Recommendation to revisit in the plan: prefer `props` for the live credential unless we need the credential to outlive a single grant or to be shared across grants. If we keep D1, the AES key is a Worker secret, and we must plan key rotation. Either way, NEVER log the plaintext and NEVER pass it through the MCP token boundary. [cf-oauth-provider, spec-security]

### 5.3 Tool annotations are NOT a security gate for destructive actions — IMPORTANT CHANGE
- Annotations (`destructiveHint`, etc.) are **hints only**, normatively untrusted, and MUST NOT drive security decisions. They are fine for UX (badging, prompting) but cannot enforce a destructive-action gate. [spec-tools]
- The actual gate is **elicitation** (`elicitation/create`, form mode) — a server-initiated confirmation the server enforces before proceeding, returning a result only on `action: "accept"`. This matches the TrainHeroic destructive-actions policy (warn + require explicit user action). [spec-elicitation]
- Caveats to bake in: the CF `elicitInput` wrapper returns only `"accept" | "decline"` (no `"cancel"`) — treat any non-accept as abort. Elicitation requires client support (e.g. Claude Desktop); not all clients implement it, so the server must also degrade safely (e.g. refuse the destructive call if elicitation is unsupported, or require an explicit `confirm: true` argument as a fallback). Form mode MUST NOT request secrets/credentials — those go through URL mode. Bind elicitation to the verified user identity, not session ID. [spec-elicitation, cf-mcpagent]
- Net: keep `destructiveHint: true` on delete/publish tools for UX, but the enforcement is elicitation-in-handler, not the annotation.

### 5.4 `/mcp` + `/sse` via `apiHandlers` — WORKS, with nuances
- `apiHandlers: { "/mcp": MyMCP.serve("/mcp"), "/sse": MyMCP.serveSSE("/sse") }` is valid (multi-handler form). Do NOT also set `apiRoute`/`apiHandler` — it is one form or the other. [cf-oauth-provider]
- The current Cloudflare GitHub-OAuth demo uses the **single-handler** form (`apiHandler: MyMCP.serve("/mcp")` + `apiRoute: "/mcp"`), exposing only `/mcp`. SSE is legacy. [cf-reference-and-d1]
- agents 0.8.7 adds `serve("/mcp", { transport: "auto" })` which serves Streamable HTTP and legacy SSE on **one** endpoint, so we may not need a separate `/sse` handler at all. Decide: single `/mcp` with `transport: "auto"` vs explicit `/mcp` + `/sse` handlers. [cf-mcpagent]
- The DO binding name in the demo is `MCP_OBJECT` (not `MyMCP`); `class_name` is what must match the exported class. Keep `serve("/mcp", { binding })` consistent with the wrangler binding name. [cf-reference-and-d1, cf-mcpagent]

### 5.5 Other deltas worth flagging
- `allowPlainPKCE` defaults to **true** for back-compat. We MUST set it `false` to meet the spec's S256 requirement. [cf-oauth-provider, spec-authorization]
- RFC 9728 PRM is now MANDATORY for MCP and the library serves it automatically — but we MUST set `resourceMetadata.resource` to our canonical MCP URI for correct audience advertising. [cf-oauth-provider, spec-authorization]
- The current demo's `/authorize` flow is no longer "everything in a signed cookie": it uses a signed `__Host-APPROVED_CLIENTS` cookie (HMAC-SHA256) + a KV-backed one-time hashed `state` (`__Host-CONSENTED_STATE`) + a one-time CSRF token (`__Host-CSRF_TOKEN`). KV (`OAUTH_KV`) is now required even for the consent flow, not only token storage. Mirror this pattern. [cf-reference-and-d1]
- Header casing is `MCP-Protocol-Version` / `MCP-Session-Id` (the SDK handles emission; cosmetic vs old `Mcp-Session-Id`). [spec-transport]
- `Origin`-invalid is now a hard **403** MUST (new in 2025-11-25); Workers should reject bad Origin with 403. The SDK/handler covers this on the managed path. [spec-transport]

---

## 6. Open risks

1. **Elicitation client support gap.** Not all MCP clients implement elicitation; if a client cannot confirm, our destructive gate has no UI. Mitigation: refuse destructive calls when elicitation is unsupported, and/or require an explicit `confirm: true` tool argument as a fallback. The CF wrapper also drops the spec's `"cancel"` action. [spec-elicitation, cf-mcpagent]
2. **Credential lifetime vs grant lifetime.** TrainHeroic credentials may expire/rotate independently of the OAuth token. If stored only in `props`, a stale credential is bound to a still-valid MCP token. Decide a refresh strategy (`tokenExchangeCallback` re-login, or D1-stored creds refreshed out-of-band). [cf-oauth-provider]
3. **AES key management (if D1 path chosen).** A single Worker-secret AES key encrypting all creds is a high-value target with no built-in rotation. Plan rotation and re-encryption. The `props` path avoids this but ties creds to grant lifetime. [cf-reference-and-d1]
4. **`McpServer` global-scope footgun.** Declaring `server` outside the instance (module scope) triggers the SDK's already-connected guard and risks cross-client response leakage. Must stay a per-instance class field. [cf-mcpagent]
5. **Per-session DO state resets.** Each client session is a fresh `McpAgent` DO instance; state does not persist across reconnects of the same client. Do not rely on `this.state` for anything that must survive reconnect — durable data (creds, history cache) belongs in D1/KV. [cf-mcpagent]
6. **Spec RC churn (2026-07-28).** The RC removes protocol-level sessions, adds RFC 9207 `iss` validation, OIDC `application_type` in DCR, and issuer-bound re-registration on resource migration. Treat per-request token auth + audience validation as the stable core; isolate session-binding code so it can be removed. [spec-security]
7. **Token-audience binding with the library.** The library issues opaque tokens and validates them on `apiRoute`; if we ever front it with an external AS (Cloudflare Access / separate IdP), WE become responsible for verifying the token audience equals our MCP server and rejecting mismatches. [cf-oauth-provider, spec-authorization]
8. **PII in logs.** TrainHeroic athlete data is personal; the spec forbids PII/secrets in MCP log notifications. Long syncs that emit progress/logging must scrub names/emails. [spec-elicitation]
9. **D1 hard limits at scale.** 100 bound params/query, 100KB/statement, 2MB/row, 1000 queries/invocation (Paid). Bulk programming-history/messaging syncs must batch (one `batch()` = one transaction) to stay within the per-invocation subrequest limit. [cf-reference-and-d1]
10. **Zod v4 requirement.** agents ≥0.8.0 requires `zod ^4.0.0`; any existing Zod v3 schemas in the skill/codebase must be migrated. [cf-mcpagent]
