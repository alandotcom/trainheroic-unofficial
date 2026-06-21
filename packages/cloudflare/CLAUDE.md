# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This package is `@trainheroic-unofficial/cloudflare`, the hosted Worker. For the workspace
dependency graph and shared conventions, read [../../CLAUDE.md](../../CLAUDE.md) first.
Operational setup lives in [DEPLOY.md](./DEPLOY.md).

## Role

The multi-tenant host for the shared tools. It adds OAuth, per-tenant D1 storage, and the
warehouse sync tools to the `core` tool set. It runs on workerd, so it depends on the
runtime-agnostic `.` entry of `js`, never on `js/node`.

## Where things live

- `src/index.ts`: the OAuth provider wiring, the per-IP edge rate limiting that runs before
  `provider.fetch`, and the scheduled (cron) purge. The provider's `apiHandlers` mount three
  variant paths (most-specific first, since matching is prefix-ordered): `/mcp` (full),
  `/mcp/coach`, `/mcp/athlete` — each to its own Sentry-wrapped DO class/binding.
- `src/agent.ts`: the `McpAgent` Durable Object. An abstract `TrainHeroicMCPBase` does the work
  in `init()` (one instance per client session; throws if the grant props are missing); three
  concrete subclasses set which surfaces register — `TrainHeroicMCP` (athlete + coach, role-aware),
  `CoachMCP` (coach only), `AthleteMCP` (athlete only). Each is a separate DO class because the
  path is invisible to the DO; the binding is the only way it learns which variant it is.
- `src/auth/`: the `/authorize` login flow, the login page, and the crypto helpers.
- `src/store/`: the per-tenant D1 layer. `ExerciseStore` implements the SDK's `ExerciseIndex`
  interface (the hosted counterpart to the in-memory `ExerciseLibrary`); the programming and
  messaging stores back the warehouse zones.
- `src/tools/sync.ts`: the warehouse sync tools, which belong here because they need D1.
- `src/tool-metrics.ts`: patches the `registerTool` seam (once, in `init()`) so every tool call
  emits aggregate Sentry metrics (`mcp.tool.call`, `mcp.tool.duration_ms`, tagged by tool +
  surface + ok/error) and tags its trace span with the tool name, surface, and opaque
  mcp-session-id. Lives here, not in `core`, so the shared tool layer stays Sentry-agnostic.
- `src/sentry.ts`: the shared Sentry config (`sentryOptions(env)`) used by both `withSentry`
  (the handler in `index.ts`) and `instrumentDurableObjectWithSentry` (the DO export). Sends the
  error + user email, aggregate metrics, and traces (`SENTRY_TRACES_SAMPLE_RATE` var, default 1);
  see the invariant below.
- `migrations/`: the D1 schema, applied in order.

## Invariants and gotchas

- workerd only. Use Web-standard APIs; do not import `node:*` or `@trainheroic-unofficial/js/node`.
- Every D1 store is scoped per tenant by `org_id`. New tables and queries must keep that
  scoping, or one coach's data leaks into another's.
- Credentials live only in the encrypted grant `props`, never in logs, the user id, or
  metadata. The inbound MCP token is not forwarded to TrainHeroic.
- `COOKIE_ENCRYPTION_KEY` is the only required secret and signs the CSRF and OAuth round-trip
  values; `ALLOWED_EMAILS` and `SENTRY_DSN` are optional secrets. Credentials are never a deploy
  secret here: each user enters them at login and they live in the OAuth grant's encrypted `props`.
- Sentry is privacy-constrained on purpose: the only data it sends is the error and the user
  email. `src/sentry.ts` keeps `sendDefaultPii` off and forces `httpServerIntegration`'s
  `maxRequestBodySize: "none"` so request bodies (the login POST password) are never captured;
  the email is attached via `Sentry.setUser` in `agent.ts` (`init()` and the `onError` override,
  because each per-message DO invocation gets a fresh isolation scope). With no `SENTRY_DSN` the
  SDK is disabled and every Sentry call is a no-op. Keep new PII out of error paths, and do not
  set the user to anything but the email.
- Migrations are append-only. Add a new numbered file; do not edit a migration that has
  already been applied. After changing bindings, run `pnpm cf-typegen`.
- The `wrangler.jsonc` KV and D1 ids are placeholders until a real deployment fills them.
- Rate limiting lives at the edge in `src/index.ts` (keyed by `CF-Connecting-IP`), backed by
  two `ratelimits` bindings in `wrangler.jsonc` (`LOGIN_RATE_LIMITER`, `MCP_RATE_LIMITER`).
  It is best-effort and per-colo. Keep it out of `core` so the shared tools stay
  transport-agnostic; per-identity limiting would have to live in the DO. Re-run
  `pnpm cf-typegen` after editing the block.
- Tools that are not storage-specific belong in `core`, so the local server gets them too.
  Only add a tool here when it genuinely needs D1 or the Worker environment.

## Commands

These scripts are package-local (not at the workspace root).

```bash
pnpm dev                 # wrangler dev (local workerd + Miniflare)
pnpm inspect             # MCP Inspector UI; connect it to http://localhost:8787/mcp (needs pnpm dev)
pnpm deploy              # wrangler deploy
pnpm cf-typegen          # wrangler types -> worker-configuration.d.ts
pnpm db:migrate:local    # migrations against the local D1
pnpm db:migrate          # migrations against the remote D1
pnpm typecheck
pnpm test                # runs inside workerd via @cloudflare/vitest-pool-workers
pnpm exec vitest run test/<file>.test.ts
```
