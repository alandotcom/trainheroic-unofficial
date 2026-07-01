# Plan 001: Add deterministic CLI integration tests against the eval fake backend

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2a865c5..HEAD -- packages/eval packages/cli`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `2a865c5`, 2026-07-01

## Why this matters

`packages/cli/src/cli.ts` is 1,542 lines — the argv dispatcher plus every coach and
athlete command handler — and the only deterministic test in the package is
`packages/cli/test/parse.test.ts` (24 lines, 4 tests, covering only the arg parser in
`parse.ts`). The CLI is the toolkit's scripting surface and the engine behind the
published Claude Code skill, so regressions in command routing, session caching, or
output formatting reach users directly. The LLM evals in `packages/eval/evals/` do
exercise the CLI, but only behind `RUN_EVALS=1` with a paid `claude -p` call — they are
not part of `pnpm check` or CI. This plan adds deterministic (no-LLM) integration tests
that spawn the real CLI against the existing fake TrainHeroic backend, so `pnpm check`
catches CLI breakage. It is also the characterization safety net that plan 002 (splitting
`cli.ts` into modules) depends on.

## Current state

- `packages/cli/src/cli.ts` — the whole CLI: usage text, dispatch, ~40 command handlers
  for `whoami`, `coach …`, and `athlete …` command groups. Entry point invoked as
  `tsx src/cli.ts` (the package.json `start` script) and via the built `bin`.
- `packages/cli/test/parse.test.ts` — the only test in the package.
- `packages/eval/src/fake-backend.ts` — a fake TrainHeroic HTTP backend (Hono app) that
  answers the exact routes the SDK calls. `startBackend(dataset)` (line 307) returns a
  `BackendHandle`:

  ```ts
  export type BackendHandle = {
    url: string;
    port: number;
    /** Every "METHOD path" the backend received, in order. */
    requests: string[];
    /** Routes that hit the 501 catch-all — a non-empty list means a real routing gap. */
    unmatched: string[];
    /** Every mutating request, in order — what a write-mode grader asserts against. */
    writes: WriteRecord[];
    reset: () => void;
    close: () => Promise<void>;
  };
  ```

- `packages/eval/src/demo.ts` — populated fixtures `demoCoach` / `demoAthlete` (datasets
  the backend serves). `packages/eval/src/datasets.ts` has builders (`buildOrg`,
  `largeRoster(300)`, `historyAthlete()`, …).
- `packages/eval/src/paths.ts` — `tsxBin(pkg)` and `pkgEntry(pkg, rel)` resolve the tsx
  binary and a package source file from the repo root; the eval CLI driver launches the
  CLI as `tsxBin("cli") + pkgEntry("cli", "src/cli.ts")`.
- `packages/eval/src/surfaces/cli.ts` lines 82–92 show the exact env the CLI needs to
  talk to the fake backend instead of production:

  ```ts
  TRAINHEROIC_EMAIL: `fake-${role}@example.com`,
  TRAINHEROIC_PASSWORD: "fake-password",
  TH_COACH_BASE: url,
  TH_APIS_BASE: url,
  TH_AUTH_URL: `${url}/auth`,
  TRAINHEROIC_SESSION_FILE: join(dir, "session.json"),
  TRAINHEROIC_CACHE_FILE: join(dir, "library.json"),
  ```

- `packages/eval/test/fake-backend.test.ts` — the existing deterministic test file in
  the eval package: starts `startBackend(dataset)` in `beforeEach`-style setup, closes it
  in `afterEach`. **Model the new file's structure after it.** The eval package's `test`
  script is `vitest run test`, which runs under workspace-wide `pnpm test` and therefore
  under `pnpm check` — no wiring needed.
- Why the tests live in `packages/eval/test/` and not `packages/cli/test/`: the fake
  backend, datasets, and path helpers all live in the (private, unpublished) eval
  package, and the eval package already spawns the CLI by path without depending on it.
  Importing eval from cli's tests would invert that relationship for no benefit.
- Repo conventions: strict TypeScript (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`); oxlint warns at 120 lines per
  function — keep test helpers small; oxfmt formats (run `pnpm fmt` before finishing).
- Write commands require `--yes` (e.g. `coach log-set … --yes`); without it the CLI
  fails with a message instead of writing. Usage text lives at the top of `cli.ts`.

## Commands you will need

| Purpose            | Command                                                        | Expected on success |
|--------------------|----------------------------------------------------------------|---------------------|
| Install            | `pnpm install`                                                 | exit 0              |
| Typecheck (eval)   | `cd packages/eval && pnpm typecheck`                           | exit 0              |
| New tests only     | `cd packages/eval && pnpm exec vitest run test/cli-integration.test.ts` | all pass  |
| Whole gate         | `pnpm check` (repo root)                                       | exit 0              |
| Format             | `pnpm fmt` (repo root)                                         | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `packages/eval/test/cli-integration.test.ts` (create)
- `packages/eval/src/paths.ts` (only if a small helper export is genuinely needed)

**Out of scope** (do NOT touch, even though they look related):
- `packages/cli/src/**` — no production changes; this plan only characterizes current
  behavior. If a test reveals a real bug, note it in your report; do not fix it here.
- `packages/eval/src/fake-backend.ts`, `datasets.ts`, `shapes.ts` — if a route you need
  is missing (501 in `unmatched`), that is a STOP condition, not something to add here.
- `packages/eval/evals/**` — the LLM scenarios are a different layer.

## Git workflow

- Branch: `advisor/001-cli-integration-tests` off the current branch.
- Commit style (from `git log`): conventional-commit prefixes, e.g.
  `test(eval): deterministic CLI integration tests against the fake backend`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Build a `runCli` helper

In the new test file, write a helper that spawns the CLI once and captures output:

```ts
import { execFile } from "node:child_process";
// runCli(backendUrl, dir, args): Promise<{ stdout: string; stderr: string; code: number }>
```

It must invoke `tsxBin("cli")` with `pkgEntry("cli", "src/cli.ts")` plus `args`, with env
exactly as in the "Current state" excerpt (fake creds, `TH_COACH_BASE`/`TH_APIS_BASE`/
`TH_AUTH_URL` pointed at the backend URL, `TRAINHEROIC_SESSION_FILE` and
`TRAINHEROIC_CACHE_FILE` inside a per-test temp dir), and must not reject on non-zero
exit (return the code instead). Reuse `mkdtemp`/`rm` from `node:fs/promises` the way
`packages/eval/src/surfaces/cli.ts` does.

**Verify**: `cd packages/eval && pnpm exec vitest run test/cli-integration.test.ts` →
the file runs (even with a single placeholder test) and exits 0.

### Step 2: Read-path coverage (coach + shared)

Using `startBackend(demoCoach()… )` — check `packages/eval/src/demo.ts` for the exact
demo builder signatures before use — add tests:

1. `trainheroic whoami` → exit 0, stdout mentions the fixture account (assert on a
   stable substring from the dataset, not full-output snapshots).
2. `trainheroic coach athletes` → exit 0, stdout contains a fixture athlete's name.
3. `trainheroic coach program <id>` with a fixture program id → exit 0, stdout contains
   that program's title.
4. Unknown command (`trainheroic frobnicate`) → non-zero exit, stderr/stdout contains
   usage or an unknown-command message.
5. After any successful run, assert `backend.unmatched` is empty (a 501 means the CLI
   called a route the fake backend doesn't model — that's a finding, see STOP).

**Verify**: same vitest command → all new tests pass.

### Step 3: Athlete read-path coverage

With an athlete-flavored dataset (`demoAthlete()` or `historyAthlete()`):

6. `trainheroic athlete profile` → exit 0, fixture-derived substring present.
7. `trainheroic athlete workouts --start <date> --end <date>` (flag names per the usage
   text in `cli.ts` — read it first) → exit 0.
8. `trainheroic athlete prs` → exit 0.

**Verify**: same vitest command → all pass.

### Step 4: Session-cache behavior

9. Run two consecutive read commands sharing one `TRAINHEROIC_SESSION_FILE`; assert the
   session file exists after the first run and that `backend.requests` contains exactly
   one auth call (`POST /auth`-ish — match on the substring the backend records) across
   both runs. This pins the login-once/cache behavior.

**Verify**: same vitest command → all pass.

### Step 5: Write-path gating

10. `trainheroic coach log-set … ` **without** `--yes` → non-zero exit or refusal
    message, and `backend.writes` is empty.
11. The same command **with** `--yes` and a loggable fixture (see the note in
    `packages/eval/CLAUDE.md`: loggable fixtures come from `programWorkout()`-based
    datasets whose `saved_workout.workoutSets` is populated) → exit 0 and
    `backend.writes` contains a PUT to `/1.0/coach/savedworkoutsetexercise/`-style path.
    If assembling a loggable fixture proves deeper than reading `demo.ts`/`datasets.ts`
    allows, keep test 10 and drop test 11 — note the drop in your report.

**Verify**: same vitest command → all pass. Then `pnpm fmt && pnpm check` at the repo
root → exit 0.

## Test plan

This plan *is* tests. Target: ~10 focused tests as listed (9 minimum if test 11 is
dropped), each asserting on exit code + a stable output substring + backend request/write
records — never on full-output snapshots (they'd make plan 002's refactor noisy).
Model file structure on `packages/eval/test/fake-backend.test.ts`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `packages/eval/test/cli-integration.test.ts` exists with ≥9 passing tests
- [ ] `cd packages/eval && pnpm exec vitest run test/cli-integration.test.ts` exits 0
- [ ] `pnpm check` at the repo root exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- A CLI read command hits the fake backend's 501 catch-all (`backend.unmatched`
  non-empty) — the backend is missing a route; extending it is out of scope here.
- The CLI cannot be pointed at the backend via the documented env vars (`TH_COACH_BASE`
  etc. appear ignored) — the excerpts have drifted.
- A test reveals an actual CLI bug (wrong exit code, crash on valid input). Report it;
  do not patch `cli.ts`.
- Spawning via `tsxBin("cli")` fails in your environment after `pnpm install`.

## Maintenance notes

- Plan 002 (splitting `cli.ts`) relies on these tests as its regression net — keep
  assertions behavior-level (exit codes, substrings, backend records), not
  structure-level.
- When a new CLI command ships, add one integration test here alongside the eval
  wiring steps already documented in `packages/eval/CLAUDE.md`.
- Reviewer: scrutinize that assertions test real behavior (a test that only checks
  exit 0 on `--help` proves little).
