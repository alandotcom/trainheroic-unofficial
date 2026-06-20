# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This package is `@trainheroic-unofficial/cloudflare`, the hosted Worker. For the workspace
dependency graph and shared conventions, read [../../../CLAUDE.md](../../../CLAUDE.md) first.
Operational setup lives in [DEPLOY.md](./DEPLOY.md).

## Role

The multi-tenant host for the shared tools. It adds OAuth, per-tenant D1 storage, and the
warehouse sync tools to the `core` tool set. It runs on workerd, so it depends on the
runtime-agnostic `.` entry of `js`, never on `js/node`.

## Where things live

- `src/index.ts`: the OAuth provider wiring and the scheduled (cron) purge.
- `src/agent.ts`: the `McpAgent` Durable Object. `init()` builds the `ToolContext` and
  registers the core tools plus `registerSyncTools`. One instance per client session; it
  throws if the grant props are missing.
- `src/auth/`: the `/authorize` login flow, the login page, and the crypto helpers.
- `src/store/`: the per-tenant D1 layer. `ExerciseStore` implements the SDK's `ExerciseIndex`
  interface (the hosted counterpart to the in-memory `ExerciseLibrary`); the programming and
  messaging stores back the warehouse zones.
- `src/tools/sync.ts`: the warehouse sync tools, which belong here because they need D1.
- `migrations/`: the D1 schema, applied in order.

## Invariants and gotchas

- workerd only. Use Web-standard APIs; do not import `node:*` or `@trainheroic-unofficial/js/node`.
- Every D1 store is scoped per tenant by `org_id`. New tables and queries must keep that
  scoping, or one coach's data leaks into another's.
- Credentials live only in the encrypted grant `props`, never in logs, the user id, or
  metadata. The inbound MCP token is not forwarded to TrainHeroic.
- `COOKIE_ENCRYPTION_KEY` is the only required secret and signs the CSRF and OAuth round-trip
  values. The `CRED_ENC_KEY` mentioned in the `wrangler.jsonc` comment is not used by the
  code; treat it as stale.
- Migrations are append-only. Add a new numbered file; do not edit a migration that has
  already been applied. After changing bindings, run `pnpm cf-typegen`.
- The `wrangler.jsonc` KV and D1 ids are placeholders until a real deployment fills them.
- Tools that are not storage-specific belong in `core`, so the local server gets them too.
  Only add a tool here when it genuinely needs D1 or the Worker environment.

## Commands

These scripts are package-local (not at the workspace root).

```bash
pnpm dev                 # wrangler dev (local workerd + Miniflare)
pnpm deploy              # wrangler deploy
pnpm cf-typegen          # wrangler types -> worker-configuration.d.ts
pnpm db:migrate:local    # migrations against the local D1
pnpm db:migrate          # migrations against the remote D1
pnpm typecheck
pnpm test                # runs inside workerd via @cloudflare/vitest-pool-workers
pnpm exec vitest run test/<file>.test.ts
```
