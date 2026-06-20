# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

An unofficial TypeScript toolkit for the (undocumented) TrainHeroic coaching API. The
same tool layer ships in three shapes: a remote multi-tenant MCP server on Cloudflare
Workers, a local single-user stdio MCP server, and a CLI.

All active code lives in the `mcp/` pnpm workspace. The top-level `skills/trainheroic-api/`
is the legacy Python skill that the CLI (`@trainheroic-unofficial/cli`) supersedes; treat
it as deprecated unless a task is explicitly about it. `docs/` holds the design plan and
the MCP spec-compliance notes.

## Commands

Everything below runs inside `mcp/`. Requires Node >= 22 and pnpm 10 (`packageManager`
pins the version). Run `pnpm install` once.

Workspace-wide scripts exist at the `mcp/` root and fan out to every package:

```bash
pnpm build        # tsdown build of all publishable packages
pnpm typecheck    # tsc --noEmit everywhere
pnpm test         # vitest in every package
pnpm lint         # oxlint --deny-warnings
pnpm fmt          # oxfmt (NOT prettier, despite .prettierignore)
pnpm check        # fmt:check + lint + typecheck + test (run before considering work done)
```

`dev`, `start`, `deploy`, `cf-typegen`, and the D1 migration scripts do NOT exist at the
workspace root. They are per-package and must be run with a filter or from inside the
package directory:

```bash
# Local stdio server (single user, no DB):
TRAINHEROIC_EMAIL=... TRAINHEROIC_PASSWORD=... \
  pnpm --filter @trainheroic-unofficial/coach-mcp start

# Hosted Cloudflare worker, local dev (workerd + Miniflare, no CF account needed):
cd packages/cloudflare && pnpm db:migrate:local && pnpm dev   # http://localhost:8787/mcp
cd packages/cloudflare && pnpm cf-typegen                     # regenerate worker-configuration.d.ts
cd packages/cloudflare && pnpm deploy                         # see DEPLOY.md for one-time setup

# CLI:
TRAINHEROIC_EMAIL=... TRAINHEROIC_PASSWORD=... \
  pnpm --filter @trainheroic-unofficial/cli start whoami
```

Run a single test file or a single test by name from within the owning package:

```bash
cd packages/js && pnpm exec vitest run test/workout-encode.test.ts
cd packages/js && pnpm exec vitest run -t "broadcasts a scalar over sets"
```

Note that `packages/cloudflare` tests run inside workerd via
`@cloudflare/vitest-pool-workers` (config in its `vitest.config.ts`), so they exercise the
real Worker runtime, not Node. Every other package uses plain Node vitest.

## Architecture

The dependency graph runs in one direction; nothing lower depends on anything higher.

- **`dto`** (`@trainheroic-unofficial/dto`) — zod schemas and DTOs. The single source of
  truth for request/response shapes (e.g. the workout spec). No runtime deps. Both servers
  and the CLI import shapes from here rather than redefining them.
- **`js`** (`@trainheroic-unofficial/js`) — the runtime-agnostic SDK: `TrainHeroicClient`,
  auth, the workout encoder, messaging helpers, and the in-memory `ExerciseLibrary`. The
  `.` entry never imports `node:*` so it runs on workerd; filesystem helpers
  (`JsonFileLibraryCache`, cache paths) live behind the separate `./node` export. Keep
  that split intact — putting `node:fs` in the `.` entry breaks the Worker build.
- **`core`** (`@trainheroic-unofficial/core`) — the shared MCP tool layer. Every tool is a
  `registerXxxTools(server, ctx)` function that takes a `ToolContext`
  (`{ client, index }`). This is where tools are defined once and reused by both servers.
- **`local`** (`@trainheroic-unofficial/coach-mcp`) — stdio MCP server. Builds a
  `ToolContext` from env credentials + `ExerciseLibrary` (JSON-file cache), registers the
  core tools, connects over stdio. No OAuth, no database. Entry: `src/server.ts`.
- **`cloudflare`** (`@trainheroic-unofficial/cloudflare`) — hosted Worker. OAuth 2.1 via
  `@cloudflare/workers-oauth-provider` + the Agents SDK `McpAgent` (one Durable Object per
  session). Builds a `ToolContext` with a D1-backed `ExerciseStore`, registers the same
  core tools, plus its own D1-only warehouse `sync` tools. Entry: `src/index.ts`,
  agent in `src/agent.ts`.
- **`cli`** (`@trainheroic-unofficial/cli`) — argv-driven tool over the `js` SDK directly
  (no MCP). Caches the session under `~/.trainheroic/`.

The central seam is the `ExerciseIndex` interface (in `js/src/exercise-index.ts`). Local
implements it in memory (`ExerciseLibrary`); hosted implements it over D1
(`cloudflare/src/store/exercises.ts`). Because the core tools depend only on the
interface, resolve/search/create behave identically across both servers. When adding a
tool that needs the exercise store, add it to `core` against `ExerciseIndex`; only reach
into a server package when the tool is genuinely transport- or storage-specific (the D1
warehouse syncs are the only current example).

### TrainHeroic API specifics

- Two hosts: `api.trainheroic.com` (default, `base: "coach"`) and `apis.trainheroic.com`
  (`base: "apis"`). The client switches via `RequestOptions.base`.
- Auth has no refresh token. `TrainHeroicClient` holds credentials, acquires a
  `session-token` lazily, caches it in memory, and on a 401/403 re-logs in once and
  retries. Concurrent cold requests share a single in-flight login.
- On the Worker, credentials live only in the OAuth grant's end-to-end-encrypted `props`;
  the inbound MCP bearer token is never forwarded upstream.

### MCP tool conventions

- Tool bodies return results in-band. Use the helpers in `core/src/context.ts`:
  `jsonResult`, `errorResult`, `apiCall`, and `attempt` (which converts thrown errors into
  an `isError` result so the model can self-correct). Annotation presets: `READ`, `SYNC`,
  `DESTRUCTIVE`.
- Destructive or athlete-facing tools (message send/delete, workout publish, session
  remove, and non-GET `th_request`) must gate through `confirmGate` (`core/src/confirm.ts`).
  It prefers MCP elicitation and falls back to an explicit `confirm: true` arg; it fails
  closed. The `destructiveHint` annotation is advisory only — the real enforcement is the
  gate.

## Conventions

- Build tooling: tsdown for the publishable packages (each has a `tsdown.config.ts`),
  wrangler for the Worker. Lint/format is oxlint + oxfmt, configured in `mcp/.oxlintrc.json`
  (note `max-lines-per-function` warns at 120). TypeScript is strict with
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`;
  shared compiler options are in `mcp/tsconfig.base.json`.
- TrainHeroic state (session cache, exercise library JSON) is written under
  `~/.trainheroic/`, never in the repo.
- The two READMEs differ in scope: `mcp/README.md` documents the servers and is current;
  the top-level `README.md` covers the workspace and the legacy skill.
