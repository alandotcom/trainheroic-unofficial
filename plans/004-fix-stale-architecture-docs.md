# Plan 004: Fix stale architecture docs — the db package is invisible and store paths are wrong

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2a865c5..HEAD -- CLAUDE.md README.md packages/cloudflare/CLAUDE.md packages/cloudflare/README.md packages/db`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `2a865c5`, 2026-07-01

## Why this matters

The per-tenant D1 layer moved out of the worker into a shared `packages/db` package
(commit `6d64d72`, "shared db package"), but the workspace docs still describe the old
layout. This repo is deliberately agent-operated (CLAUDE.md is the primary onboarding
surface), so actively-wrong paths send both agents and humans to directories that no
longer exist: at the planned-at commit, `packages/cloudflare/src/store/` **does not
exist** — stores live in `packages/db/src/stores/`, the schema in
`packages/db/src/schema.ts`, and the batch helpers in `packages/db/src/d1.ts` — yet both
CLAUDE.md files reference `src/store/…` throughout, and neither the root CLAUDE.md
architecture list nor the root README package table mentions `db` at all.

## Current state

All excerpts verified at commit `2a865c5`:

- Actual layout: `packages/db/src/` contains `base.ts`, `d1.ts`, `sqlite.ts`,
  `schema.ts`, `runner.ts`, `migrations.ts`, `index.ts`, and
  `stores/{exercises,programming,messaging,athlete-workouts,athlete-training,coach-prs}.ts`.
  `packages/db/package.json` is `"private": true`, name `@trainheroic-unofficial/db`,
  depended on by `packages/cloudflare` (`workspace:*`). `packages/cloudflare/src/` has
  **no `store/` directory** (only `agent.ts`, `index.ts`, `sentry.ts`,
  `tool-metrics.ts`, `types.ts`, `auth/`, `tools/`).

- Root `CLAUDE.md`, Architecture section — the bullet list covers `dto`, `js`, `core`,
  `coach-mcp`, `athlete-mcp`, `cloudflare`, `cli`, `website`; there is **no `db`
  bullet**. Two stale statements:
  - the `cloudflare` bullet: "a coach account also gets the coaching surface (the core
    coach tools + a D1-backed `ExerciseStore` + the coach warehouse)" — acceptable, but
    the following seam paragraph is wrong:
  - "The central seam is the `ExerciseIndex` interface (in `js`). Local implements it in
    memory (`ExerciseLibrary`); hosted implements it over D1
    (`cloudflare/src/store/exercises.ts`)." → the D1 implementation is
    `packages/db/src/stores/exercises.ts`.

- `packages/cloudflare/CLAUDE.md`, "Where things live" — a whole stale bullet:
  "`src/store/`: the per-tenant D1 layer. `ExerciseStore` implements the SDK's
  `ExerciseIndex` interface … `src/store/schema.ts` is the typed table definition, and
  the base stores wrap their `D1Database` in a Drizzle handle (`makeDb`). The shared
  write helpers (`runGroups`/`runBatches`, the cursor upserts) live in `src/store/d1.ts`…"
  Also in "Invariants and gotchas": "When a migration changes a table, hand-update
  `src/store/schema.ts` to match" — should point at `packages/db/src/schema.ts`.
  (Note: `migrations/` genuinely still lives in `packages/cloudflare/migrations/` — do
  not move that reference.)

- Root `README.md`, "Packages" table — lists `dto`, `js`, `core`, `coach-mcp`,
  `athlete-mcp`, `cloudflare`, `cli`, `website`. No `db` row (and no `eval` row; `eval`
  is also a workspace package, `packages/eval`).

- Check `packages/cloudflare/README.md` and `packages/db/README.md` (if present) for the
  same stale `src/store/` references and fix any found the same way.

- Convention: these are prose docs — match the existing measured, factual tone; keep
  edits minimal and surgical. Do not restructure sections.

## Commands you will need

| Purpose       | Command                                                            | Expected on success        |
|---------------|--------------------------------------------------------------------|----------------------------|
| Find stale refs | `grep -rn "src/store" --include="*.md" . --exclude-dir=node_modules --exclude-dir=plans` | only CHANGELOG hits remain after the fix |
| Whole gate    | `pnpm check` (repo root)                                           | exit 0 (docs don't affect it, but run it) |

## Scope

**In scope** (the only files you should modify):
- `CLAUDE.md` (root)
- `README.md` (root)
- `packages/cloudflare/CLAUDE.md`
- `packages/cloudflare/README.md` (only if it has the same stale paths)
- `packages/db/README.md` / `packages/db/CLAUDE.md` (only if present and inaccurate)

**Out of scope** (do NOT touch):
- `packages/*/CHANGELOG.md` — historical release notes legitimately reference old paths.
- Any source file. This is a docs-only plan.
- The website content (`packages/website/**`) — its docs are generated/curated
  separately; only flag in your report if you notice the same drift there.

## Git workflow

- Branch: `advisor/004-fix-stale-architecture-docs`
- One commit, e.g. `docs: catch CLAUDE.md/README up to the shared db package`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Root CLAUDE.md

Add a `db` bullet to the Architecture list, placed after `core` (its consumers come
after it): describe it factually — private (unpublished) shared D1/SQLite warehouse
layer; Drizzle schema (`src/schema.ts`), org-scoped stores
(`src/stores/…` — exercises, programming, messaging, athlete-workouts,
athlete-training, coach-prs), D1 adapter (`src/d1.ts`) and node:sqlite adapter
(`src/sqlite.ts`); used by `cloudflare`. Fix the seam paragraph:
`cloudflare/src/store/exercises.ts` → `db/src/stores/exercises.ts` (keep the sentence
shape). Update the `cloudflare` bullet's parenthetical if it names a path.

**Verify**: `grep -n "src/store" CLAUDE.md` → no matches.

### Step 2: cloudflare CLAUDE.md

Rewrite the `src/store/` bullet into a pointer at the `db` package: where the stores now
live (`@trainheroic-unofficial/db`: `src/schema.ts`, `src/stores/`, `src/d1.ts`), what
remains here (`migrations/` as the source of truth for the live DB, `wrangler.jsonc`
bindings), and keep the Drizzle RC pin note (`drizzle-orm@1.0.0-rc.3`) accurate —
the pin now lives in `packages/db/package.json` (and `drizzle-kit` in
`packages/cloudflare/package.json`). Fix the migrations invariant to say hand-update
`packages/db/src/schema.ts`.

**Verify**: `grep -n "src/store" packages/cloudflare/CLAUDE.md` → no matches.

### Step 3: Root README package table

Add a `db` row: `@trainheroic-unofficial/db` → "shared warehouse layer (Drizzle schema +
org-scoped stores; D1 and node:sqlite), internal / not published". Add an `eval` row in
the same style ("in-code eval harness, internal / not published") — the table currently
implies it lists all packages, so make it actually complete. Link both to their package
directories like the existing rows.

**Verify**: `grep -c "trainheroic-unofficial/" README.md` includes the two new package
rows; visually confirm the table renders (pipe alignment).

### Step 4: Sweep

Run the stale-ref grep from the commands table across all markdown; fix remaining
non-CHANGELOG hits inside the in-scope file list; report (don't fix) hits elsewhere.

**Verify**:
`grep -rn "src/store" --include="*.md" . --exclude-dir=node_modules --exclude-dir=plans | grep -v CHANGELOG`
→ no output. Then `pnpm check` → exit 0.

## Test plan

Not applicable (docs). The grep in Step 4 is the machine check.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] Step 4 grep returns no non-CHANGELOG matches
- [ ] Root CLAUDE.md architecture list contains a `db` bullet; README table contains
      `db` and `eval` rows
- [ ] `pnpm check` exits 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `packages/cloudflare/src/store/` actually exists in your checkout (the layout has
  drifted back or the drift check was skipped).
- Correcting a statement would require describing behavior you cannot verify by reading
  the code it points at — don't guess; report the sentence instead.

## Maintenance notes

- Whenever a module moves between packages, grep the two CLAUDE.md layers and the README
  in the same commit — this repo's agents treat those files as ground truth.
- Reviewer: check the new `db` bullet's claims against `packages/db/src/` one more time;
  wrong new docs are worse than the old stale ones.
