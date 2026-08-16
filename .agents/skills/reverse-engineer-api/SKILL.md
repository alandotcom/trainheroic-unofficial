---
name: reverse-engineer-api
description: >-
  End-to-end workflow for reverse-engineering an undocumented TrainHeroic
  endpoint and landing it as dto schemas, SDK methods, MCP tools, CLI commands,
  tests, and docs. Use when a new API is discovered (HAR, UI traffic, PR notes,
  GitHub issues, Still Unexplored lists), when wrapping a probed path into the
  toolkit, or when asked to add an endpoint to dto/js/core/cli. Distinct from
  live-api-probe (archaeology only) and mcp-eval/cli-eval (usability).
---

# Reverse-engineer a TrainHeroic API

Turn a discovered endpoint into a typed vertical slice: **dto → js → core MCP → CLI → tests → catalog**.

Live probing is a step in this loop, not the whole job. For the probe recipe itself, read
[`.claude/skills/live-api-probe/SKILL.md`](../../../.claude/skills/live-api-probe/SKILL.md)
first. Current coverage vs gaps: [coverage.md](coverage.md) and
[`docs/agents/api-coverage.md`](../../../docs/agents/api-coverage.md).

Do not invent a raw-request tool. Every endpoint becomes a typed SDK method and a typed
MCP tool (CLI when a human would script it).

## Checklist

Copy and track:

```
- [ ] 1. Discover (HAR / UI / PR / issue / coverage.md)
- [ ] 2. Live-probe (claim, disposable calendar, cleanup, delete script)
- [ ] 3. dto zod schema + inferred type
- [ ] 4. js SDK method (coach vs apis host; no node:* on ".")
- [ ] 5. core MCP tool (annotations, confirmGate if destructive)
- [ ] 6. CLI command if a human would script it
- [ ] 7. Tests (unit; live probe only to pin the shape)
- [ ] 8. eval tools.ts + canonical.ts + fake-backend; website catalog
- [ ] 9. coverage.md + api-reference Still Unexplored; changeset; pnpm fmt
```

## 1. Discover

Candidates come from, in order:

1. Coach/athlete web HAR (`api.trainheroic.com` / `apis.trainheroic.com`) while clicking the UI.
2. GitHub issues and recent PR notes (a probe that found a path but did not wrap it).
3. [coverage.md](coverage.md) and the "Still Unexplored" sections in
   `packages/cli/skill/trainheroic-unofficial/references/api-reference.md` and
   `packages/cli/skill/trainheroic-athlete/references/athlete-api.md`.
4. Comments in `packages/js/src/` and `packages/core/src/tools/` ("run after deleting via the API").

Record: method, path, host (`coach` default vs `base: "apis"`), role (coach / athlete / both),
request body, and why it matters. Skip marketplace, telemetry, TOS, and avatars unless a user
asked.

## 2. Live-probe

Follow live-api-probe. Preconditions: repo-root `.env` (`TRAINHEROIC_EMAIL` /
`TRAINHEROIC_PASSWORD`; optional `TRAINHEROIC_ATHLETE_*`). Never print credentials.

```bash
set -a && source .env && set +a
CI=true pnpm --filter @trainheroic-unofficial/js exec tsx scripts/<probe>.mts
```

Rules that bite:

- Wrap in `async function main`. Pass `expectedStatuses` on speculative GETs/DELETEs so a 404
  is not treated as a session failure. **401/403 always re-login once** — a speculative path
  that 401s will burn a login; prefer 404/405 probes after a known-good GET.
- `TrainHeroicClient.request` does **not** send a body on `GET` or `DELETE`. If the UI uses
  DELETE-with-body, probe with POST/PUT equivalents or a one-off `fetch`.
- Create throwaway teams/programs/exercises; far-future dates; clean up; delete the script.
- If `.env` is missing, implement from captured HAR/PR notes and mark the row **unverified**
  in coverage.md. Do not invent shapes.

## 3. dto

`packages/dto` is the only place a shape is defined.

- New file under `packages/dto/src/` (or the matching domain module) and export from `index.ts`.
- Input schemas validate. Response schemas tolerate: `z.looseObject`, `intLike` number-or-string.
  Do not `strictObject` an undocumented payload.
- Export `fooSchema` and `type Foo = z.infer<typeof fooSchema>`.
- Example: `programCreateResponseSchema` in `packages/dto/src/responses.ts`;
  `exerciseCreateSchema` in `packages/dto/src/exercise.ts`.

## 4. SDK (`packages/js`)

- Runtime-agnostic `.` entry (`src/index.ts`). No `node:*`. Filesystem helpers go in `./node`.
- Two hosts via `RequestOptions.base`. Default is the coach host.
- Put real request-shaping in `coach.ts` / `athlete.ts` / a focused module — not in MCP/CLI.
- Exercise-library writes go on `ExerciseIndex` (`create`, and any update/delete that must
  write through the mirror). Implement both `ExerciseLibrary` (`js`) and `ExerciseStore`
  (`packages/db`).
- Re-export new functions from `src/index.ts`.
- `checkResponse(schema, data, label)` on responses we depend on; throw a useful Error on
  `!res.ok`.
- Example: `createProgram` in `packages/js/src/coach.ts` (two ids, `nameApplied`).

## 5. MCP (`packages/core`)

- Add to the matching `registerXxxTools` in `packages/core/src/tools/`. Coach tools must be
  reached via `registerCoachTools`. Athlete training tools via `registerAthleteTrainingTools`.
- Return `jsonResult` / `errorResult` / `apiCall` / `attempt`. Never throw out of a handler.
- Annotations: `READ` / `SYNC` / `DESTRUCTIVE` from `context.ts`. Additive writes use
  `{ readOnlyHint: false, destructiveHint: false, openWorldHint: true }`.
- Gate destructive or athlete-facing tools with `confirmGate` **before any read or write**:

  ```ts
  const blocked = confirmGate(extra, `Delete …?`, confirm);
  if (blocked) return blocked;
  ```

- Thin single-request CRUD can stay as `apiCall`. Shaping logic belongs in `js`.
- Example: `program_create` in `packages/core/src/tools/programs.ts`;
  `team_delete` for the confirmGate pattern.

## 6. CLI (`packages/cli`)

- Thin adapter: validate with the dto schema, call the SDK, print JSON on stdout.
- Destructive commands require `--yes`.
- Update the help text in `src/cli.ts` (usage line + the command group).
- Example: `cmdCoachProgramCreate` / `cmdCoachTeamDelete`.

## 7. Tests

TDD: failing unit test first, then the method.

| Layer | Where | What to pin |
| --- | --- | --- |
| dto | `packages/dto/test/` | schema accepts the captured payload |
| js | `packages/js/test/<name>.test.ts` | request method/path/body + normalized result |
| core | `packages/core/test/<name>.test.ts` | tool result + confirmGate when destructive |
| db | `packages/cloudflare/test/exercise-store.test.ts` | write-through on `ExerciseIndex` changes |
| eval | `packages/eval/test/canonical.test.ts` + fake-backend | CLI map + route exists (no 501) |

Do not leave a live probe in the tree. Fold the claim into a stubbed unit test.

```bash
cd packages/js && pnpm exec vitest run test/<file>.test.ts
cd packages/core && pnpm exec vitest run test/<file>.test.ts
```

## 8. Eval catalog and website

A new capability is invisible to evals and the docs site until these agree:

1. `packages/eval/src/tools.ts` — add the MCP name to the role's `readTools` or `writeTools`.
2. `packages/eval/src/canonical.ts` — map `coach <cmd>` / `athlete <cmd>` to that **same** name.
3. `packages/eval/src/fake-backend.ts` — route the path (read in `buildApp` /
   `registerAthleteReads`; write in `registerWrites` that `record()`s).
4. `packages/website/src/data/mcp-tool-catalog.ts` — `TOOL_SUMMARIES` + exactly one group.
5. `pnpm --filter @trainheroic-unofficial/website gen:mcp-tools` — regenerates
   `src/content/docs/developers/mcp/02-tools.mdx`. Do not edit that page by hand.

See `packages/eval/CLAUDE.md` ("Adding a tool / command").

## 9. Conventions

- `pnpm fmt` on touched packages (CI `fmt:check` fails on drift).
- Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- Changeset at `.changeset/` listing every publishable package you touched (fixed group —
  one changeset bumps the suite). Follow existing changeset tone.
- Update [coverage.md](coverage.md) status: unknown → probed → dto → SDK → MCP → CLI → tests.
- Move the row out of "Still Unexplored" in the CLI skill api-reference.
- Do not commit secrets, probe scripts, or HAR dumps (`flows*` is gitignored).

## When to stop

One endpoint (or one CRUD family) per slice. If the probe fails, land the skill/coverage
update and any endpoints that already have captured shapes. Open a GitHub issue for a
high-value path you could not confirm.

## Examples in this repo

| Slice | Files to copy |
| --- | --- |
| Program create (two ids) | `js/src/coach.ts` `createProgram`, `core/src/tools/programs.ts`, `js/test/create-program.test.ts` |
| Destructive team delete | `core/src/tools/teams.ts` `team_delete`, CLI `--yes` |
| ExerciseIndex write-through | `js/src/exercise-index.ts` `create`, `db/src/stores/exercises.ts` |
| Athlete read | `js/src/athlete.ts` + `core/src/tools/athlete-training.ts` |
