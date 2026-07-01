# Plan 003: Wire the shipped-but-unreachable coach PR warehouse into hosted MCP tools

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2a865c5..HEAD -- packages/cloudflare packages/db packages/website/src/data`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `2a865c5`, 2026-07-01

## Why this matters

`CoachAthletePrStore` (`packages/db/src/stores/coach-prs.ts`) is a complete, tested,
org-scoped warehouse for roster main-lift PRs: `sync()` pulls the roster's PR board via
`fetchRosterMainLiftPRs` and stores one row per logged lift family with atomic
per-athlete replacement; `read()` returns the stored board; `lastSynced()` reports
freshness. It is exported from `@trainheroic-unofficial/db` and covered by
`packages/db/test/coach-prs.test.ts` — **and nothing outside `packages/db` references it**
(verified at the planned-at commit: zero imports of `CoachAthletePrStore` in
`packages/cloudflare`, `packages/core`, or `packages/cli`). Coaches can read live PRs
(`roster_main_lift_prs`) but cannot accumulate a persisted board the way every other
warehouse zone works (programming, messaging, athlete training). This plan wires the
store into the hosted worker's sync tool file as `coach_prs_sync` / `coach_prs_stored`,
following the exact pattern of the four existing warehouse tools.

## Current state

- `packages/cloudflare/src/tools/sync.ts` — the coach warehouse tools. Shape to mirror
  (lines 24–50):

  ```ts
  export function registerSyncTools(
    server: McpServer,
    warehouse: Warehouse,
    client: TrainHeroicClient,
    orgId: number | null = null,
  ): void {
    const programming = new ProgrammingStore(warehouse, client, orgId);
    const messaging = new MessagingStore(warehouse, client, orgId);

    server.registerTool(
      "programming_sync",
      {
        title: "Sync programming history",
        description: "Populate the programming history warehouse: …",
        inputSchema: { programId: idParam.optional() },
        annotations: SYNC,
      },
      ({ programId }) =>
        attempt(async () => { … }),
    );
    …
  ```

  Each zone is one SYNC-annotated populate tool + one READ-annotated query tool, bodies
  wrapped in `attempt(async () => jsonResult(…))`. Helpers (`attempt`, `jsonResult`,
  `errorResult`, `idParam`, `toId`, `READ`, `SYNC`) come from
  `@trainheroic-unofficial/core`.

- `packages/db/src/stores/coach-prs.ts` — the store to wire:

  ```ts
  async sync(
    opts: { months?: number; athleteIds?: readonly number[]; now?: Date } = {},
  ): Promise<CoachPrSyncResult>            // { athletes, rows, syncedAt }
  async read(): Promise<CoachAthletePrRow[]>   // ordered by athlete then family
  async lastSynced(): Promise<number | null>
  ```

- `packages/cloudflare/src/agent.ts` line 74 — `registerSyncTools(server, warehouse,
  client, orgId)` is already called from `registerCoachSurface`; adding the tools inside
  `registerSyncTools` needs **no** agent.ts change.
- D1 schema: the `coach_athlete_pr` table already exists in `packages/db/src/schema.ts`
  (`coachAthletePr`) and in the applied migrations — `sync()`/`read()` work against the
  existing schema. **No migration is needed.** If you find otherwise, STOP.
- Tests to model after: `packages/cloudflare/test/sync-store.test.ts` (workerd-pool test
  of the warehouse tools/stores against real D1 bindings) and
  `packages/db/test/coach-prs.test.ts` (the store's own coverage — do not duplicate it).
- Website tool catalog: `packages/website/src/data/mcp-tool-catalog.ts` carries the
  hosted-only tool list (contains `"programming_sync"` near line 12) and a one-line
  summary map (`programming_sync: "Sync prescribed programming history into D1"` near
  line 90). The site's build regenerates the tool index from this file (`prebuild` runs
  `gen:mcp-tools`, which asserts list/summary parity) — if the two edits disagree, the
  website build fails loudly.
- Naming: follow the domain glossary `CONTEXT.md` — "roster athlete", "main-lift PRs".
  Tool descriptions should cross-reference the live tool (`roster_main_lift_prs`) the
  same way `programming_stored` points at `get_program`.

## Commands you will need

| Purpose            | Command                                                        | Expected on success |
|--------------------|----------------------------------------------------------------|---------------------|
| Install            | `pnpm install`                                                 | exit 0              |
| Worker typecheck   | `cd packages/cloudflare && pnpm typecheck`                     | exit 0              |
| Worker tests       | `cd packages/cloudflare && pnpm test`                          | all pass (workerd)  |
| One test file      | `cd packages/cloudflare && pnpm exec vitest run test/sync-store.test.ts` | all pass |
| Website build      | `pnpm website:build` (repo root)                               | exit 0              |
| Whole gate         | `pnpm check` (repo root)                                       | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `packages/cloudflare/src/tools/sync.ts`
- `packages/cloudflare/test/sync-store.test.ts` (or a new sibling test file)
- `packages/website/src/data/mcp-tool-catalog.ts`

**Out of scope** (do NOT touch):
- `packages/db/**` — the store is done; if it seems to need changes, STOP.
- `packages/cloudflare/src/agent.ts` — registration flows through `registerSyncTools`.
- `packages/cloudflare/migrations/**` — no schema change is part of this plan.
- `packages/core/**` — these tools need D1, so they belong in the cloudflare package
  (per the workspace convention: "A tool that needs the exercise store goes in core…
  reach into a server package only when a tool is genuinely transport- or
  storage-specific").
- `packages/eval/**` — the eval drives the *local* servers; hosted-only warehouse tools
  are not in its allow-lists (none of the existing sync tools are either).
- CLI counterpart (`trainheroic coach prs-sync` into local SQLite) — explicitly deferred;
  the store supports it (its doc comment notes the node:sqlite adapter) but it is a
  separate plan.

## Git workflow

- Branch: `advisor/003-coach-prs-warehouse-tools`
- Conventional commits, e.g. `feat(cloudflare): coach_prs_sync + coach_prs_stored warehouse tools`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Register `coach_prs_sync`

In `registerSyncTools`, import `CoachAthletePrStore` from `@trainheroic-unofficial/db`,
instantiate `const coachPrs = new CoachAthletePrStore(warehouse, client, orgId);`
alongside the other two stores, and register:

- name: `coach_prs_sync`
- title: `Sync roster main-lift PRs`
- description: populate the roster main-lift PR warehouse; optional `athleteIds` to sync
  a subset, optional `months` lookback; point the reader at `coach_prs_stored`, and note
  the live counterpart `roster_main_lift_prs` (mirror the tone of the existing
  descriptions in this file).
- inputSchema: `{ months: z.number().int().positive().optional(), athleteIds: z.array(idParam).optional() }`
  (match how existing tools express optional ints; convert with `toId` as needed).
- annotations: `SYNC`
- body: `attempt(async () => jsonResult(await coachPrs.sync({ …defined opts only… })))` —
  note `exactOptionalPropertyTypes` is on: spread optional fields conditionally the way
  `coach-prs.ts` itself does (`...(opts.months !== undefined ? { months: opts.months } : {})`).

**Verify**: `cd packages/cloudflare && pnpm typecheck` → exit 0.

### Step 2: Register `coach_prs_stored`

- name: `coach_prs_stored`
- title: `Query stored roster PRs`
- description: read the stored board (populate with `coach_prs_sync` first); for live
  data use `roster_main_lift_prs`.
- inputSchema: `{}` (no arguments — read() returns the whole org board, which is one row
  per athlete × logged family; that is bounded and fine).
- annotations: `READ`
- body: return `jsonResult({ lastSynced: await coachPrs.lastSynced(), rows: await coachPrs.read() })`
  so a never-synced org reads as `{ lastSynced: null, rows: [] }` instead of a bare `[]`.

**Verify**: `cd packages/cloudflare && pnpm typecheck` → exit 0.

### Step 3: Workerd test

Extend `packages/cloudflare/test/sync-store.test.ts` (or add
`test/coach-prs-tools.test.ts` modeled on it): with the test env's D1 binding and a
stubbed client whose responses satisfy `fetchRosterMainLiftPRs` (see how the existing
sync-store tests stub upstream responses — follow that pattern exactly), assert:

1. `coach_prs_sync` result reports `athletes`/`rows` counts and `coach_prs_stored`
   then returns those rows with `lastSynced` set.
2. A second sync replaces (not duplicates) an athlete's rows.
3. Org scoping: rows synced under org A are invisible when the store resolves org B
   (the existing store tests show how org resolution is stubbed).

**Verify**: `cd packages/cloudflare && pnpm exec vitest run test/<the file>.ts` → all pass.

### Step 4: Website catalog

In `packages/website/src/data/mcp-tool-catalog.ts`, add `coach_prs_sync` and
`coach_prs_stored` to the hosted-only tool list (next to `programming_sync`) and add
one-line summaries to the summary map (e.g. "Sync roster main-lift PRs into D1" /
"Query the stored roster PR board").

**Verify**: `pnpm website:build` → exit 0 (the gen script's parity assertion passes).

### Step 5: Full gate

**Verify**: `pnpm fmt && pnpm check` at the repo root → exit 0.

## Test plan

- New workerd tests per Step 3 (sync→stored round trip, replace-not-duplicate,
  org isolation), modeled on `packages/cloudflare/test/sync-store.test.ts`.
- Do not re-test store internals already covered by `packages/db/test/coach-prs.test.ts`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "coach_prs_sync\|coach_prs_stored" packages/cloudflare/src/tools/sync.ts` shows both registrations
- [ ] `cd packages/cloudflare && pnpm test` exits 0, including ≥3 new assertions per Step 3
- [ ] `pnpm website:build` exits 0
- [ ] `pnpm check` exits 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `coachAthletePr` table is missing from the applied migrations (i.e. `sync()`
  fails against the test D1 with a missing-table error) — a migration would be needed,
  and migrations are out of scope.
- `CoachAthletePrStore`'s constructor or method signatures differ from the excerpts
  (drift).
- The website gen script rejects the catalog additions for a structural reason beyond
  adding the two names + summaries.
- You feel the need to modify anything in `packages/db` or `packages/core`.

## Maintenance notes

- If a CLI/local counterpart ships later (the store already supports node:sqlite), keep
  the tool names as the canonical capability names per the eval-harness convention.
- Future PR-board features (e.g. history/time-series rather than replace-per-sync) will
  need a schema change; today's store intentionally replaces per athlete.
- Reviewer: check the two descriptions read well next to the existing four warehouse
  tools (an MCP client shows them side by side), and that optional args spread
  conditionally (`exactOptionalPropertyTypes`).
