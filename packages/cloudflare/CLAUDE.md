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
  `/mcp/coach`, `/mcp/athlete` — each to a `createMcpHandler` factory from `mcp.ts`. OAuth
  enables Client ID Metadata Documents (CIMD), which requires the `global_fetch_strictly_public`
  compatibility flag in `wrangler.jsonc` — enable the two together or not at all. Dynamic Client
  Registration (`/register`) is kept for the deprecation window. `resourceMetadata.resource` is
  left unset so the library derives it per request, which is the only value correct for all
  three mount paths and every origin.
- `src/mcp.ts`: MCP SDK v2 server factories. One module-level `createMcpHandler` per
  `McpVariant` (`full` | `coach` | `athlete`); bindings come from
  `import { env } from "cloudflare:workers"`. Credentials come from the OAuth grant via
  `getMcpAuthContext`, narrowed by `parseProps` (which normalizes `role` rather than rejecting
  it, so grants issued before `AccountRole` existed keep working). `selectSurfaces` is the
  authorization boundary — an athlete account never gets coach tools — and is pinned by
  `test/mcp.test.ts`. Coach tools register through `registerCoachTools` from `core`. The
  factory runs once per HTTP request, so a module-level `sessionCache` keyed by `thUserId`
  holds the TrainHeroic session token; without it every tool call would replay the user's
  password against `/auth`. Pass `onerror` to `createMcpHandler` for anything that must reach
  Sentry — the SDK catches errors and answers 500 without rethrowing, so `withSentry` in
  `index.ts` never sees them. Do not pass `allowedHostnames`: it replaces the SDK's
  localhost/`workers.dev` defaults rather than adding to them, which 403s local dev. No MCP
  Durable Objects (see `docs/adr/0001-mcp-sdk-v2-migration.md`, issue #73).
- `src/auth/`: the `/authorize` login flow, the login page, and the crypto helpers.
- `src/store/`: the per-tenant D1 layer. `ExerciseStore` implements the SDK's `ExerciseIndex`
  interface (the hosted counterpart to the in-memory `ExerciseLibrary`); the programming and
  messaging stores back the warehouse zones. Queries go through Drizzle ORM (pinned to the v1
  release candidate `drizzle-orm@1.0.0-rc.3`): `src/store/schema.ts` is the typed table
  definition, and the base stores wrap their `D1Database` in a Drizzle handle (`makeDb`). The
  shared write helpers (`runGroups`/`runBatches`, the cursor upserts) live in `src/store/d1.ts`
  and operate over Drizzle batch items.
- `src/tools/sync.ts`: the warehouse sync tools, which belong here because they need D1.
- `src/tools/feedback.ts`: the `report_feedback` tool — a cross-cutting bug/feedback reporter
  registered on every variant (tagged surface `system`). It routes the report to Sentry's user
  feedback channel (`Sentry.captureFeedback`) when a DSN is set, and falls back to a structured
  `console.log` otherwise. Hosted-only because it leans on the Worker's Sentry setup. The report
  inlines the user's message plus non-PII context (correlation id `user:<thUserId>`, role,
  version/release); the reporter's email rides along as the feedback contact.
- `src/tool-metrics.ts`: patches the `registerTool` seam (once, while building the server) so
  every tool call emits aggregate Sentry metrics (`mcp.tool.call`, `mcp.tool.duration_ms`,
  tagged by tool + surface + ok/error) and runs inside its own `mcp.tool/<name>` span (tagged
  with tool, surface, ok/error, and `user:<thUserId>`). Lives here, not in `core`, so the shared
  tool layer stays Sentry-agnostic.
- `src/sentry.ts`: the shared Sentry config (`sentryOptions(env)`) used by `withSentry` (the
  handler in `index.ts`). Sends the error + user email, aggregate metrics, and traces
  (`SENTRY_TRACES_SAMPLE_RATE` var, default 1). Without MCP protocol sessions, traces and
  errors correlate on `mcp.session` = `user:<thUserId>` (opaque numeric id, stamped in the MCP
  factory and tool-metrics). D1 queries are traced separately via
  `Sentry.instrumentD1WithSentry`, applied once inside `makeDb` (`store/schema.ts`).
- `migrations/`: the D1 schema, applied in order.

## Invariants and gotchas

- workerd only. Use Web-standard APIs and `cloudflare:*` modules; do not import `node:*` or
  `@trainheroic-unofficial/js/node`. Prefer `import { env } from "cloudflare:workers"` over
  threading Worker `env` through every call.
- Every D1 store is scoped per tenant by `org_id`. New tables and queries must keep that
  scoping, or one coach's data leaks into another's.
- Credentials live only in the encrypted grant `props`, never in logs, the user id, or
  metadata. The inbound MCP token is not forwarded to TrainHeroic.
- `COOKIE_ENCRYPTION_KEY` is the only required secret and signs the CSRF and OAuth round-trip
  values; `ALLOWED_EMAILS` and `SENTRY_DSN` are optional secrets. Credentials are never a deploy
  secret here: each user enters them at login and they live in the OAuth grant's encrypted `props`.
- Sentry is privacy-constrained on purpose: the data it sends is the error, the user email,
  aggregate metrics/traces (tool name, surface, ok/error, opaque `user:<thUserId>`), and — only
  when the user explicitly files one — a `report_feedback` report (the user's own message plus
  that same non-PII context, with their email as the contact). `src/sentry.ts` keeps
  `sendDefaultPii` off and forces `httpServerIntegration`'s `maxRequestBodySize: "none"` so
  request bodies (the login POST password) are never captured; the email is attached via
  `Sentry.setUser` in the MCP factory (`mcp.ts`). With no `SENTRY_DSN` the SDK is disabled and
  every Sentry call is a no-op (the feedback tool then logs the report to `console` instead).
  Keep new PII out of error paths and out of tool args/results sent to Sentry, and do not set
  the user to anything but the email.
- Migrations are append-only. Add a new numbered file; do not edit a migration that has
  already been applied. After changing bindings, run `pnpm cf-typegen`. `migrations/` is the
  source of truth for the live DB — Drizzle does NOT generate it. When a migration changes a
  table, hand-update `src/store/schema.ts` to match (verify with `drizzle-kit pull`/`check` via
  `drizzle.config.ts`, which only reads the DB and never writes migrations).
- The `wrangler.jsonc` KV and D1 ids are placeholders until a real deployment fills them.
- Rate limiting lives at the edge in `src/index.ts` (keyed by `CF-Connecting-IP`), backed by
  two `ratelimits` bindings in `wrangler.jsonc` (`LOGIN_RATE_LIMITER`, `MCP_RATE_LIMITER`).
  It is best-effort and per-colo. Keep it out of `core` so the shared tools stay
  transport-agnostic. Re-run `pnpm cf-typegen` after editing the block.
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
