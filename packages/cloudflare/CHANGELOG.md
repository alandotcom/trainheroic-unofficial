# @trainheroic-unofficial/cloudflare

## 1.6.1

### Patch Changes

- e7aa780: Update dependencies. Worker runtime deps move: `agents` 0.16.2 → 0.17.1, `hono` 4.12.26 → 4.12.27, `@sentry/cloudflare` 10.59.0 → 10.62.0. Dev tooling also refreshed (`oxlint`, `oxfmt`, `wrangler`, `@cloudflare/vitest-pool-workers`, `@types/node`, and `@hono/node-server` v1 → v2 in the eval harness).
  - @trainheroic-unofficial/js@1.6.1
  - @trainheroic-unofficial/core@1.6.1
  - @trainheroic-unofficial/db@1.6.1

## 1.6.0

### Patch Changes

- Updated dependencies [6f7da89]
  - @trainheroic-unofficial/js@1.6.0
  - @trainheroic-unofficial/core@1.6.0
  - @trainheroic-unofficial/db@1.6.0

## 1.5.0

### Minor Changes

- 62dd187: feat(cloudflare): user feedback / bug-report tool for the hosted MCP

  Adds a `report_feedback` MCP tool to every variant of the hosted Worker (`/mcp`, `/mcp/coach`,
  `/mcp/athlete`) so a user can ask the assistant to file a bug report or send feedback about the
  integration itself. When `SENTRY_DSN` is configured it routes to Sentry's user-feedback channel
  (`Sentry.captureFeedback`) and returns a reference id; with no DSN it falls back to a structured
  `console.log`, so a report is never silently dropped in local dev or an unconfigured deploy.

  The report is self-contained: the user's message plus auto-captured, non-PII context — session id,
  role, app version/release, and the last few tool calls. That activity trail comes from a small
  per-session ring buffer now kept by the `tool-metrics.ts` instrumentation (tool name, surface,
  ok/error, duration — never arguments or results). The privacy invariant holds: the only PII sent is
  the reporter's own email, attached as the feedback contact, and it correlates with that session's
  existing error events and traces via the shared `mcp.session` tag.

### Patch Changes

- 44082fd: fix(cloudflare): tighten report_feedback guidance so reports are actionable

  A test report surfaced that the `report_feedback` tool's instructions let the assistant file vague,
  filler reports (one came through with meta commentary about the tool and a fabricated
  `expected`/`actual`). The tool description now tells the assistant to get a concrete problem before
  filing: when the user only says something like "report a bug", it first asks what happened, what
  they were doing, and what they expected, then files with those answers. It holds to what the user
  actually reported instead of inventing detail, and labels a pure test plainly in `message` while
  leaving `expected`/`actual` empty rather than making up a bug. The `message` field now asks for a
  specific summary line first, which Sentry uses as the report title.

- Updated dependencies [dffd968]
  - @trainheroic-unofficial/js@1.5.0
  - @trainheroic-unofficial/core@1.5.0
  - @trainheroic-unofficial/db@1.5.0

## 1.4.0

### Patch Changes

- Updated dependencies [b776fe2]
- Updated dependencies [b776fe2]
- Updated dependencies [b776fe2]
- Updated dependencies [b776fe2]
  - @trainheroic-unofficial/js@1.4.0
  - @trainheroic-unofficial/core@1.4.0
  - @trainheroic-unofficial/db@1.4.0

## 1.3.0

### Minor Changes

- 6d64d72: feat(coach): main-lift PRs across SDK, MCP, and CLI + shared db package

  A coach can pull every roster athlete's personal records for the main barbell lifts (squat,
  bench, deadlift, overhead press, clean & jerk, snatch) in one call. Resolution is
  discovery-driven: it reads what each athlete actually logged (the program-workout range, not the
  monthly calendar summary, which comes back empty for some accounts) and buckets the real variant
  they train — so "Back Squat", "Goblet Squat", "Incline DB Bench Press", or "Shoulder Press" land
  in the right family instead of a naive name lookup hitting an empty library entry.

  Surfaces: the `fetchAthleteMainLiftPRs` / `fetchRosterMainLiftPRs` / `classifyMainLift` SDK calls
  (plus `fetchCoachRoster`), the `athlete_main_lift_prs` and `roster_main_lift_prs` MCP tools (local
  coach server and hosted worker), and the `coach main-lift-prs [--athlete | --athletes | --months]`
  CLI command. `presentExerciseHistory` now carries each PR's units.

  Also extracts the Drizzle warehouse layer into a new `@trainheroic-unofficial/db` package shared
  by the worker and any local tool, with two adapters: `db/d1` (Cloudflare D1) and `db/sqlite`
  (Node's built-in `node:sqlite`). The one driver-specific operation, atomic batch, is injected as a
  `BatchExec` (D1 `batch()` vs sqlite `BEGIN`/`COMMIT`), so one store body runs on both. The worker
  now consumes this package; its behaviour is unchanged. Migrations are single-sourced in the db
  package (wrangler reads them there) and embedded so the `db/sqlite` `applyMigrations` runner brings
  a local SQLite database up to schema. A `CoachAthletePrStore` syncs the roster PR board into either
  warehouse.

### Patch Changes

- Updated dependencies [6d64d72]
  - @trainheroic-unofficial/js@1.3.0
  - @trainheroic-unofficial/core@1.3.0
  - @trainheroic-unofficial/db@1.3.0

## 1.2.0

### Patch Changes

- Updated dependencies [0f99401]
- Updated dependencies [72bd48b]
- Updated dependencies [f41ac54]
  - @trainheroic-unofficial/js@1.2.0
  - @trainheroic-unofficial/core@1.2.0

## 1.1.1

### Patch Changes

- Updated dependencies [bb0b826]
  - @trainheroic-unofficial/js@1.1.1
  - @trainheroic-unofficial/core@1.1.1

## 1.1.0

### Patch Changes

- @trainheroic-unofficial/js@1.1.0
- @trainheroic-unofficial/core@1.1.0

## 1.0.0

### Patch Changes

- @trainheroic-unofficial/js@1.0.0
- @trainheroic-unofficial/core@1.0.0

## 0.6.5

### Patch Changes

- Updated dependencies [d0770f1]
- Updated dependencies [b0a0ca8]
  - @trainheroic-unofficial/js@0.6.5
  - @trainheroic-unofficial/core@0.6.5

## 0.6.4

### Patch Changes

- Updated dependencies
  - @trainheroic-unofficial/core@0.6.4
  - @trainheroic-unofficial/js@0.6.4

## 0.6.3

### Patch Changes

- Updated dependencies
  - @trainheroic-unofficial/core@0.6.3
  - @trainheroic-unofficial/js@0.6.3

## 0.6.2

### Patch Changes

- Updated dependencies
  - @trainheroic-unofficial/core@0.6.2
  - @trainheroic-unofficial/js@0.6.2

## 0.6.1

### Patch Changes

- Updated dependencies
  - @trainheroic-unofficial/core@0.6.1
  - @trainheroic-unofficial/js@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [6075bc4]
  - @trainheroic-unofficial/core@0.6.0
  - @trainheroic-unofficial/js@0.6.0

## 0.5.0

### Patch Changes

- @trainheroic-unofficial/js@0.5.0
- @trainheroic-unofficial/core@0.5.0

## 0.4.2

### Patch Changes

- Updated dependencies
  - @trainheroic-unofficial/core@0.4.2
  - @trainheroic-unofficial/js@0.4.2

## 0.4.1

### Patch Changes

- Updated dependencies
  - @trainheroic-unofficial/js@0.4.1
  - @trainheroic-unofficial/core@0.4.1

## 0.4.0

### Minor Changes

- 92a422f: Add first-class athlete API support, mirroring the coach offering.

  - `dto`/`js`: schemas, fetchers, and presenters for the athlete surface (profile/summary,
    scheduled + completed workouts, per-exercise history, PRs, working maxes), plus a
    set-logging write (reverse-engineered two-step PUT, verified against the live API).
  - `core`: `registerAthleteTrainingTools` — live athlete read tools and a gated
    `athlete_log_set`. (Distinct from the coach's roster `registerAthleteTools`.)
  - `athlete-mcp`: a new local stdio MCP server for an athlete account.
  - `cloudflare`: role-aware registration — every account gets the athlete surface plus a D1
    athlete history warehouse (`athlete_workouts_sync`/`_stored`,
    `athlete_training_sync`/`_stored`); coach accounts also keep the coaching surface.
  - `cli`: an `athlete` command group and `athlete export` for dumping historicals to JSON.
  - A new `trainheroic-athlete` skill.

### Patch Changes

- Updated dependencies [92a422f]
  - @trainheroic-unofficial/core@0.4.0
  - @trainheroic-unofficial/js@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [dbe2c63]
  - @trainheroic-unofficial/core@0.3.0
  - @trainheroic-unofficial/js@0.3.0
