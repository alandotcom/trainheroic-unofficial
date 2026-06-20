# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Each package under `packages/` has its own `CLAUDE.md` and `README.md` with
package-specific detail. This file is the workspace-level picture; read it first, then the
package file for whatever you are touching.

## What this repo is

An unofficial TypeScript toolkit for the undocumented TrainHeroic coaching API. One shared
tool layer runs in three shapes: a remote multi-tenant MCP server on Cloudflare Workers, a
local single-user stdio MCP server, and a CLI.

All code lives in a single pnpm workspace at the repo root.

## Commands

Everything below runs from the repo root. It needs Node >= 22 and pnpm 10 (the version is
pinned in `packageManager`). Run `pnpm install` once.

Workspace-wide scripts live at the repo root and fan out to every package:

```bash
pnpm build        # tsdown build of all publishable packages
pnpm typecheck    # tsc --noEmit everywhere
pnpm test         # vitest in every package
pnpm lint         # oxlint --deny-warnings
pnpm fmt          # oxfmt (this repo uses oxfmt, not prettier, despite .prettierignore)
pnpm check        # fmt:check + lint + typecheck + test; run this before considering work done
```

## Releasing

Versioning and publishing use [Changesets](https://github.com/changesets/changesets),
configured in `.changeset/config.json` (`access: public`, `baseBranch: main`). Publishing is
local-only for now; there is no release GitHub Action. You must be logged in to npm (`npm
whoami`) with publish rights on the `@trainheroic-unofficial` scope.

```bash
pnpm changeset          # author a changeset: pick packages, bump type, write a summary line
pnpm version-packages   # apply pending changesets: bump versions + changelogs, rewrite
                        #   internal workspace:* ranges, delete the consumed changeset files
pnpm release            # pnpm build, then `changeset publish`
```

`changeset publish` detects pnpm and shells out to `pnpm publish`, so `workspace:*` deps are
rewritten to real versions in the published manifests and an npm 2FA OTP prompt works
interactively. It only publishes packages whose version isn't already on the registry, so
re-running is safe. The private `cloudflare` worker is excluded automatically (it is
`private: true`); the five publishable packages are `dto`, `js`, `core`, `cli`, and
`coach-mcp`.

`dev`, `start`, `deploy`, `cf-typegen`, and the D1 migration scripts do not exist at the
workspace root. They are per-package, so run them with a filter or from inside the package
directory:

```bash
# Local stdio server (single user, no DB):
TRAINHEROIC_EMAIL=... TRAINHEROIC_PASSWORD=... \
  pnpm --filter @trainheroic-unofficial/coach-mcp start

# Hosted Cloudflare worker, local dev (workerd + Miniflare, no CF account needed):
cd packages/cloudflare && pnpm db:migrate:local && pnpm dev   # http://localhost:8787/mcp
cd packages/cloudflare && pnpm cf-typegen                     # regenerate worker-configuration.d.ts
cd packages/cloudflare && pnpm deploy                         # see its DEPLOY.md for one-time setup

# CLI:
TRAINHEROIC_EMAIL=... TRAINHEROIC_PASSWORD=... \
  pnpm --filter @trainheroic-unofficial/cli start whoami
```

Run a single test file, or a single test by name, from within the owning package:

```bash
cd packages/js && pnpm exec vitest run test/workout-encode.test.ts
cd packages/js && pnpm exec vitest run -t "broadcasts a scalar over sets"
```

The `cloudflare` package runs its tests inside workerd via `@cloudflare/vitest-pool-workers`
(see its `vitest.config.ts`), so they exercise the real Worker runtime. Every other package
uses plain Node vitest.

## Architecture

The dependency graph runs one direction; nothing lower depends on anything higher.

- **`dto`** (`@trainheroic-unofficial/dto`): zod schemas and the types inferred from them, the
  single source of truth for request and response shapes. No runtime deps. Servers and the
  CLI import shapes from here instead of redefining them.
- **`js`** (`@trainheroic-unofficial/js`): the runtime-agnostic SDK. It holds the
  `TrainHeroicClient`, auth, the workout encoder, messaging helpers, and the in-memory
  `ExerciseLibrary`. The `.` entry imports no `node:*` so it runs on workerd; filesystem
  helpers sit behind a separate `./node` export. Keep that split intact, because a `node:*`
  import in the `.` entry breaks the Worker build.
- **`core`** (`@trainheroic-unofficial/core`): the shared MCP tool layer. Each tool is a
  `registerXxxTools(server, ctx)` function taking a `ToolContext` (`{ client, index }`). Tools
  are defined once here and reused by both servers.
- **`coach-mcp`** (`@trainheroic-unofficial/coach-mcp`): the stdio MCP server. It builds a
  `ToolContext` from env credentials and a JSON-file `ExerciseLibrary`, registers the core
  tools, and connects over stdio. No OAuth, no database. Entry: `src/server.ts`.
- **`cloudflare`** (`@trainheroic-unofficial/cloudflare`): the hosted Worker. OAuth 2.1 via
  `@cloudflare/workers-oauth-provider` and the Agents SDK `McpAgent` (one Durable Object per
  session). It builds a `ToolContext` with a D1-backed `ExerciseStore`, registers the same
  core tools, and adds its own D1-only warehouse sync tools. Entry: `src/index.ts`, agent in
  `src/agent.ts`.
- **`cli`** (`@trainheroic-unofficial/cli`): an argv-driven tool over the `js` SDK directly, no
  MCP. It caches the session under `~/.trainheroic/`.

The central seam is the `ExerciseIndex` interface (in `js`). Local implements it in memory
(`ExerciseLibrary`); hosted implements it over D1 (`cloudflare/src/store/exercises.ts`).
Because the core tools depend only on the interface, resolve/search/create behave the same
across both servers. A tool that needs the exercise store goes in `core`, written against
`ExerciseIndex`. Reach into a server package only when a tool is genuinely transport- or
storage-specific (the D1 warehouse syncs are the current example).

### TrainHeroic API specifics

- Two hosts: `api.trainheroic.com` (default, `base: "coach"`) and `apis.trainheroic.com`
  (`base: "apis"`). The client switches via `RequestOptions.base`.
- Auth has no refresh token. `TrainHeroicClient` holds the credentials, acquires a
  `session-token` lazily, caches it in memory, and on a 401/403 re-logs in once and retries.
  Concurrent cold requests share a single in-flight login.
- On the Worker, credentials live only in the OAuth grant's end-to-end-encrypted `props`. The
  inbound MCP bearer token is never forwarded upstream.

### MCP tool conventions

- Tool bodies return results in-band. Use the helpers in `core/src/context.ts`: `jsonResult`,
  `errorResult`, `apiCall`, and `attempt` (which converts a thrown error into an `isError`
  result the model can self-correct on). The annotation presets are `READ`, `SYNC`, and
  `DESTRUCTIVE`.
- Destructive or athlete-facing tools (message send and delete, workout publish, session
  remove, and non-GET `th_request`) gate through `confirmGate` (`core/src/confirm.ts`). It
  prefers MCP elicitation and falls back to an explicit `confirm: true` argument, and it fails
  closed. The `destructiveHint` annotation is advisory; the gate is the enforcement.

## Conventions

- Build tooling: tsdown for the publishable packages (each has a `tsdown.config.ts`), wrangler
  for the Worker. Lint and format are oxlint plus oxfmt, configured in `.oxlintrc.json`
  (note `max-lines-per-function` warns at 120). TypeScript is strict with
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`; the
  shared compiler options sit in `tsconfig.base.json`.
- TrainHeroic state (the session cache and the exercise library JSON) is written under
  `~/.trainheroic/`, never in the repo.
- The root `README.md` is the workspace overview (auth model, tool catalog, local and hosted
  dev, storage, security); each package has its own README for package-specific detail.
