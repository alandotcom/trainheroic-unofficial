# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Each package under `packages/` has its own `CLAUDE.md` and `README.md` with
package-specific detail. This file is the workspace-level picture; read it first, then the
package file for whatever you are touching.

## What this repo is

An unofficial TypeScript toolkit for the undocumented TrainHeroic API. One shared
tool layer runs in several shapes: a remote multi-tenant MCP server on Cloudflare Workers,
two local single-user stdio MCP servers (one for a coach, one for an athlete), and a CLI.
The API has two roles — a coach manages a roster; an athlete trains their own program. A
coach account also carries athlete scope, so it can reach its own training data too.

All code lives in a single pnpm workspace at the repo root.

## Commands

Everything below runs from the repo root. It needs Node >= 24 and pnpm 11 (the version is
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

Versioning uses [Changesets](https://github.com/changesets/changesets) (configured in
`.changeset/config.json`: `access: public`, `baseBranch: main`, and a `fixed` group so the whole
suite shares one version). Versioning and publishing both run in CI behind a manual trigger — use
the `release` skill, which encodes the full flow and its footguns.

```bash
pnpm changeset            # author a changeset on a normal commit (fixed group → whole suite bumps)
# ...changesets accumulate on main from everyday commits...
gh workflow run release.yml   # when ready to ship: versions, tags vX.Y.Z, dispatches publish.yml
```

CI ownership (`.github/workflows/`): **`release.yml`** is manually triggered (`workflow_dispatch`)
and runs three sequenced jobs — `release` (gate on `pnpm check`, `pnpm version-packages`, commit +
push the bump to `main`, tag `vX.Y.Z`, cut the GitHub release), `deploy` (call `deploy.yml` against
the tag), then `publish` (dispatch `publish.yml`). **`deploy.yml`** applies remote D1 migrations and
deploys the Worker; it runs **only as part of a release** (via `workflow_call`), not on pushes to
`main`, so the worker moves in lockstep with the published packages rather than tracking every
feature commit. It is also `workflow_dispatch`-runnable for an emergency redeploy. **`publish.yml`**
runs `changeset publish` (build + publish), authenticated by **npm OIDC trusted publishing** (no
`NPM_TOKEN`, no interactive 2FA); the publish step stays in this file so the npm trusted-publisher
binding (tied to the `publish.yml` path) holds. `changeset publish` only publishes versions not
already on the registry, so re-runs are safe; the private `cloudflare` worker is excluded
(`private: true`). The six publishable packages are `dto`, `js`, `core`, `cli`, `coach-mcp`, and
`athlete-mcp`. The local sequence in the `release` skill is the manual fallback when CI is
unavailable.

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
  `registerXxxTools(server, ctx)` function. The coach tools take a `ToolContext`
  (`{ client, index }`); the athlete tools (`registerAthleteTrainingTools`) take only
  `{ client }` (athletes have no exercise-library index). Tools are defined once here and
  reused by every server. Note `registerAthleteTools` is the coach's *roster* view
  (`list_athletes`), distinct from `registerAthleteTrainingTools` (the athlete's own training).
- **`coach-mcp`** (`@trainheroic-unofficial/coach-mcp`): the coach stdio MCP server. It builds a
  `ToolContext` from env credentials and a JSON-file `ExerciseLibrary`, registers the core
  coach tools, and connects over stdio. No OAuth, no database. Entry: `src/server.ts`.
- **`athlete-mcp`** (`@trainheroic-unofficial/athlete-mcp`): the athlete stdio MCP server.
  It builds `{ client }` from env credentials, registers `registerAthleteTrainingTools`
  (no index, no warehouse — local has no D1), and connects over stdio. Entry: `src/server.ts`.
- **`cloudflare`** (`@trainheroic-unofficial/cloudflare`): the hosted Worker. OAuth 2.1 via
  `@cloudflare/workers-oauth-provider` and the Agents SDK `McpAgent` (one Durable Object per
  session). Tool registration is **role-aware** (`src/agent.ts`): every account gets the
  athlete surface (live tools + the D1 athlete warehouse); a coach account also gets the
  coaching surface (the core coach tools + a D1-backed `ExerciseStore` + the coach warehouse).
  Served at three paths via separate DO classes: `/mcp` (full, role-aware), `/mcp/coach`, and
  `/mcp/athlete` (one tool set each). Entry: `src/index.ts`.
- **`cli`** (`@trainheroic-unofficial/cli`): an argv-driven tool over the `js` SDK directly, no
  MCP. It caches the session under `~/.trainheroic/`. Has an `athlete` command group and an
  `athlete export` that dumps historicals to JSON (the local counterpart to the hosted warehouse).

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
- Destructive or athlete-facing tools (message send and delete, workout publish and unpublish,
  session remove, athlete archive, team and join-code delete) gate through `confirmGate`
  (`core/src/confirm.ts`). It prefers MCP elicitation and falls back to an explicit
  `confirm: true` argument, and it fails closed. The `destructiveHint` annotation is advisory;
  the gate is the enforcement. There is no raw-request tool — every endpoint is a typed tool,
  and additive writes (create/rename/invite/restore/copy) are ungated, matching `exercise_create`.

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

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`alandotcom/trainheroic-unofficial`) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root (created lazily). See `docs/agents/domain.md`.
