# Plan 005: Add a CLI↔MCP capability-parity test so surface drift fails `pnpm check`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2a865c5..HEAD -- packages/eval/src/canonical.ts packages/eval/src/tools.ts packages/eval/test`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `2a865c5`, 2026-07-01

## Why this matters

The eval harness grades CLI and MCP runs with the same predicates by mapping each CLI
command to a canonical capability name that **must equal the MCP tool name**
(`packages/eval/src/canonical.ts`) — and the tool allow-lists in
`packages/eval/src/tools.ts` carry a comment saying they "MUST stay in sync with the
tools registered in packages/core/src/tools/". Today that sync is enforced only by
convention: a new tool added to one surface but not the other, or a canonical name that
doesn't match any tool, is discovered at eval time (costs tokens) or by a user at
runtime. The two maps are plain exported data, so a deterministic vitest check in
`pnpm check` makes the drift a CI failure instead. This also gives the intentional
asymmetries (MCP-only and CLI-only capabilities) a named, reviewed home.

## Current state

- `packages/eval/src/canonical.ts` — exports `COACH_COMMANDS` and `ATHLETE_COMMANDS`,
  `Record<string, string>` mapping CLI command paths to canonical names:

  ```ts
  export const COACH_COMMANDS: Record<string, string> = {
    whoami: "whoami",
    "coach athletes": "list_athletes",
    …
    "coach log-set": "log_athlete_set",
    …
  };
  export const ATHLETE_COMMANDS: Record<string, string> = {
    "athlete whoami": "athlete_whoami",
    …
  };
  ```

- `packages/eval/src/tools.ts` — exports `COACH_READ_TOOLS`, `COACH_WRITE_TOOLS` (and
  the athlete equivalents — read the file; there is also a `ROLE_TOOLS` aggregation)
  as `readonly string[]` of MCP tool names. Header comment (lines 1–5) states the
  sync requirement and that "a tool missing from both lists is denied in every mode".
- `packages/eval/test/` — `canonical.test.ts` and `fake-backend.test.ts` already exist;
  the package's `test` script (`vitest run test`) runs in workspace `pnpm test` /
  `pnpm check`. Add the new test beside them (or extend `canonical.test.ts` if that
  reads better — your call, say which you did).
- Known asymmetries at the planned-at commit (verify, don't assume — diff the maps
  yourself as part of Step 1): coach tools like `store_stats`, `workout_read`,
  `message_draft`, `messaging_conversations`, `messaging_read` and the write tools
  (`athlete_invite`, `team_create`, …) appear in `tools.ts` without a `COACH_COMMANDS`
  entry; these are candidates for the explicit MCP-only allowlist. There may be zero
  CLI-only entries; that's fine — keep the (possibly empty) allowlist anyway.
- Repo conventions: strict TS, oxlint/oxfmt, tests use plain vitest `describe`/`it`
  with `expect` — model on `packages/eval/test/canonical.test.ts`.

## Commands you will need

| Purpose        | Command                                                          | Expected on success |
|----------------|------------------------------------------------------------------|---------------------|
| Install        | `pnpm install`                                                   | exit 0              |
| New test       | `cd packages/eval && pnpm exec vitest run test/parity.test.ts`   | all pass            |
| Package tests  | `cd packages/eval && pnpm test`                                  | all pass            |
| Whole gate     | `pnpm check` (repo root)                                         | exit 0              |

## Scope

**In scope** (the only files you should modify/create):
- `packages/eval/test/parity.test.ts` (create; or extend `test/canonical.test.ts`)

**Out of scope** (do NOT touch):
- `packages/eval/src/canonical.ts` / `src/tools.ts` — if the test finds a genuine
  mismatch (a canonical name not in any tool list), that is a real pre-existing bug:
  STOP and report it rather than "fixing" either map to make the test green.
- `packages/core/**`, `packages/cli/**` — this test checks the eval package's two maps
  against each other, not against live registrations (that deeper check is a possible
  follow-up, noted in Maintenance).

## Git workflow

- Branch: `advisor/005-cli-mcp-parity-test`
- One commit, e.g. `test(eval): pin CLI↔MCP capability parity`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Forward check — every CLI command maps to a real tool

New test: for each role, every value of `COACH_COMMANDS` / `ATHLETE_COMMANDS` must be a
member of that role's read ∪ write tool lists from `tools.ts`. Failure message must name
the command and the missing canonical name.

**Verify**: `cd packages/eval && pnpm exec vitest run test/parity.test.ts` → passes. If
it fails, STOP (see out-of-scope note) — report the mismatching entries.

### Step 2: Reverse check — every tool is reachable from the CLI or declared MCP-only

Define `const MCP_ONLY: Record<Role-ish, readonly string[]>` in the test file, listing
each tool name present in the role's tool lists but absent from the command map values.
Populate it from what the diff actually shows at HEAD, with a one-line comment per entry
saying why it has no CLI command (e.g. truncation-only helper, draft-then-send flow,
hosted-only). Assert set equality: tools − commands === MCP_ONLY, so a future tool
added without a CLI command fails until it is either given a command or consciously
added to the list.

**Verify**: same vitest command → passes; deliberately add a fake name to `MCP_ONLY`,
confirm the test fails (set equality works both ways), remove it.

### Step 3: Gate

**Verify**: `cd packages/eval && pnpm test` → all pass; `pnpm fmt && pnpm check` at the
repo root → exit 0.

## Test plan

This plan is one test file: two assertions per role (forward containment, reverse set
equality) with debuggable failure messages listing the offending names. That's the
deliverable; no other tests change.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `packages/eval/test/parity.test.ts` exists (or `canonical.test.ts` extended) with
      forward + reverse checks for both roles
- [ ] `cd packages/eval && pnpm test` exits 0
- [ ] `pnpm check` exits 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 fails: a canonical command name is missing from the tool lists — that is a
  live product bug in the maps; report which entries, do not edit the maps.
- The exported names/shapes in `canonical.ts`/`tools.ts` differ from the excerpts.
- The MCP-only remainder is so large (say, >20 entries per role) that the reverse check
  reads as noise — report the counts and your list instead of committing it blind.

## Maintenance notes

- When adding a capability, the failing parity test now points at exactly the file to
  update — keep its failure messages actionable.
- Possible follow-up (separate plan): assert the tool lists against the *actual*
  registered tool names by instantiating the core `registerXxxTools` functions with a
  stub server, closing the remaining convention gap between eval lists and
  `packages/core` registrations.
- Reviewer: read each MCP_ONLY justification comment — that list is the plan's real
  editorial content.
