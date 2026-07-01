# Plan 002: Split the 1,542-line CLI monolith into command-group modules

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2a865c5..HEAD -- packages/cli`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-cli-integration-tests.md (must be DONE first)
- **Category**: tech-debt
- **Planned at**: commit `2a865c5`, 2026-07-01

## Why this matters

`packages/cli/src/cli.ts` is 1,542 lines: usage text, argv dispatch, and every command
handler for the `whoami`, `coach`, and `athlete` groups in one file. Git history shows it
is the highest-churn source file in the workspace (11 edits in the last 50 commits) —
every new command lands another handler in the same file, reviews carry heavy diff
context, and the oxlint `max-lines-per-function` warning (threshold 120, configured in
`.oxlintrc.json`) is under constant pressure. Splitting handlers into per-group modules
makes each new command an isolated diff and each handler independently readable, with
zero behavior change.

## Current state

- `packages/cli/src/cli.ts` — everything. The usage/help text (a large template string
  near the top, with lines like
  `coach log-set --athlete <id> --date Y-M-D --set <savedWorkoutSetId> <resultsJson>|--file f --yes`
  around lines 112–194), argument coercion helpers (`toInt`, `need`, `fail`), and the
  command handlers/dispatch below (e.g. the `coach exercise forget` handler around line
  342).
- `packages/cli/src/parse.ts` — the standalone arg parser (438 lines), already separate
  and tested by `packages/cli/test/parse.test.ts`. Leave its API alone.
- `packages/cli/package.json` — `"start": "tsx src/cli.ts"`, `"test": "vitest run"`,
  build via `tsdown` (see `tsdown.config.ts` for the entry, which must keep producing the
  same bin).
- **Hard external constraint**: the eval harness spawns the CLI by file path —
  `packages/eval/src/surfaces/cli.ts` line 34 runs
  `exec "…tsx" "…packages/cli/src/cli.ts" "$@"` via `pkgEntry("cli", "src/cli.ts")` —
  and plan 001's integration tests do the same. **`src/cli.ts` must remain the entry
  point path.** It becomes a thin entry that imports the command modules.
- Deterministic regression net: `packages/eval/test/cli-integration.test.ts` (from plan
  001) plus `packages/cli/test/parse.test.ts`.
- Repo conventions: strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax` — use `import type` where applicable), oxlint + oxfmt,
  conventional-commit messages.

## Commands you will need

| Purpose        | Command                                                                  | Expected on success |
|----------------|--------------------------------------------------------------------------|---------------------|
| Install        | `pnpm install`                                                           | exit 0              |
| Typecheck      | `cd packages/cli && pnpm typecheck`                                      | exit 0              |
| CLI unit tests | `cd packages/cli && pnpm test`                                           | all pass            |
| Integration    | `cd packages/eval && pnpm exec vitest run test/cli-integration.test.ts`  | all pass            |
| Build          | `cd packages/cli && pnpm build`                                          | exit 0              |
| Whole gate     | `pnpm check` (repo root)                                                 | exit 0              |

## Scope

**In scope** (the only files you should modify/create):
- `packages/cli/src/cli.ts` (shrinks to entry + dispatch)
- `packages/cli/src/commands/shared.ts` (create — `whoami`, `help`, common helpers)
- `packages/cli/src/commands/coach.ts` (create)
- `packages/cli/src/commands/athlete.ts` (create)
- `packages/cli/src/usage.ts` (create — the help text, if extracting it reduces `cli.ts`
  meaningfully; optional)

**Out of scope** (do NOT touch):
- `packages/cli/src/parse.ts` and its tests — the parser API stays as is.
- `packages/cli/package.json` `bin`/entry configuration and `tsdown.config.ts`, except
  a change proven necessary by a failing build (report it if so).
- `packages/eval/**` — the harness must keep working *unchanged*; that is the point.
- Any behavior change: flag names, output text, exit codes, error messages. This is a
  pure move-and-rewire refactor.

## Git workflow

- Branch: `advisor/002-split-cli-monolith` (cut after plan 001 is merged/DONE).
- Commit per step; conventional style, e.g. `refactor(cli): extract athlete command handlers`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Characterize the dispatch

Read `cli.ts` end to end. Write down (in your report notes) the dispatch shape: how the
top-level token (`whoami` / `coach` / `athlete` / `help`) routes, what shared state each
handler closes over (client construction, session file, exercise library), and which
helpers (`toInt`, `need`, `fail`, output printers) are used by more than one group.

**Verify**: `cd packages/eval && pnpm exec vitest run test/cli-integration.test.ts` →
all pass (baseline green before touching anything).

### Step 2: Extract shared helpers

Create `src/commands/shared.ts` with the cross-group helpers and the client/session
bootstrap, exported with their current names. `cli.ts` imports them. No logic edits.

**Verify**: `cd packages/cli && pnpm typecheck && pnpm test` → exit 0.

### Step 3: Extract the athlete group

Move every `athlete …` handler into `src/commands/athlete.ts`, exporting a single
`runAthlete(args…)` (or a handler table — match whichever shape the existing dispatch
makes most natural). `cli.ts` delegates to it.

**Verify**: integration tests → all pass.

### Step 4: Extract the coach group

Same for `coach …` handlers into `src/commands/coach.ts`.

**Verify**: integration tests → all pass.

### Step 5: Slim the entry

`cli.ts` should now be: imports, usage/help wiring, top-level token dispatch, error
handling/exit codes. If the usage text dominates the remaining file, move it to
`src/usage.ts`. Confirm the file is a fraction of its former size (`wc -l` — expect
well under 400 lines).

**Verify**: `cd packages/cli && pnpm build` → exit 0, then run the built bin once
(`node dist/…` per package.json `bin`) with `--help`-equivalent args → same usage output
as `tsx src/cli.ts`. Then `pnpm fmt && pnpm check` at the repo root → exit 0.

## Test plan

No new tests required — plan 001's integration suite plus `parse.test.ts` are the
regression net. If you find an untested branch you had to reason hard about while
moving it, add one integration test for it in
`packages/eval/test/cli-integration.test.ts` and say so.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `wc -l packages/cli/src/cli.ts` < 400
- [ ] `cd packages/cli && pnpm typecheck && pnpm test && pnpm build` all exit 0
- [ ] `cd packages/eval && pnpm exec vitest run test/cli-integration.test.ts` exits 0
      with the same test count as before this plan (or more)
- [ ] `pnpm check` at the repo root exits 0
- [ ] `git diff --stat` shows no changes outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001's tests are not present/passing at baseline (dependency not met).
- The dispatch turns out to interleave group handlers with shared mutable state in a way
  that cannot be moved without behavior change.
- The tsdown build needs entry/config changes beyond pointing at the same `src/cli.ts`.
- Any integration test fails after a move and the fix would mean changing behavior
  rather than the move itself.

## Maintenance notes

- Future commands go in the matching `src/commands/*.ts`; `cli.ts` should only grow a
  dispatch line.
- Reviewer: verify by diff inspection that handler bodies moved verbatim (no sneaky
  logic edits), and that exit codes / error text are unchanged.
- Deferred: any behavior cleanup discovered during the move (report, don't do).
