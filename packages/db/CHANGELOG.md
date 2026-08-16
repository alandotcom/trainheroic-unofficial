# @trainheroic-unofficial/db

## 3.1.1

### Patch Changes

- Updated dependencies [0d0a9e9]
  - @trainheroic-unofficial/js@3.1.1
  - @trainheroic-unofficial/dto@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [77fd0ec]
  - @trainheroic-unofficial/dto@3.1.0
  - @trainheroic-unofficial/js@3.1.0

## 3.0.1

### Patch Changes

- Updated dependencies [100bc29]
  - @trainheroic-unofficial/js@3.0.1
  - @trainheroic-unofficial/dto@3.0.1

## 3.0.0

### Patch Changes

- Updated dependencies [5e3cf8e]
  - @trainheroic-unofficial/js@3.0.0
  - @trainheroic-unofficial/dto@3.0.0

## 2.1.2

### Patch Changes

- Updated dependencies [c8914cf]
  - @trainheroic-unofficial/js@2.1.2
  - @trainheroic-unofficial/dto@2.1.2

## 2.1.1

### Patch Changes

- Updated dependencies [448d5de]
  - @trainheroic-unofficial/js@2.1.1
  - @trainheroic-unofficial/dto@2.1.1

## 2.1.0

### Patch Changes

- Updated dependencies [28bb2fe]
  - @trainheroic-unofficial/js@2.1.0
  - @trainheroic-unofficial/dto@2.1.0

## 2.0.2

### Patch Changes

- Updated dependencies [d76fe73]
  - @trainheroic-unofficial/dto@2.0.2
  - @trainheroic-unofficial/js@2.0.2

## 2.0.1

### Patch Changes

- @trainheroic-unofficial/dto@2.0.1
- @trainheroic-unofficial/js@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [627318f]
  - @trainheroic-unofficial/js@2.0.0
  - @trainheroic-unofficial/dto@2.0.0

## 1.7.4

### Patch Changes

- e677387: Fix Durable Object OOM during full exercise-library refresh: upsert in bounded batches instead of materializing every Drizzle statement at once (Sentry TRAINHEROIC-MCP-K).
  - @trainheroic-unofficial/dto@1.7.4
  - @trainheroic-unofficial/js@1.7.4

## 1.7.3

### Patch Changes

- Updated dependencies [066de31]
  - @trainheroic-unofficial/js@1.7.3
  - @trainheroic-unofficial/dto@1.7.3

## 1.7.2

### Patch Changes

- Updated dependencies [7025fbe]
  - @trainheroic-unofficial/js@1.7.2
  - @trainheroic-unofficial/dto@1.7.2

## 1.7.1

### Patch Changes

- @trainheroic-unofficial/dto@1.7.1
- @trainheroic-unofficial/js@1.7.1

## 1.7.0

### Patch Changes

- Updated dependencies [b0240c3]
  - @trainheroic-unofficial/dto@1.7.0
  - @trainheroic-unofficial/js@1.7.0

## 1.6.1

### Patch Changes

- @trainheroic-unofficial/dto@1.6.1
- @trainheroic-unofficial/js@1.6.1

## 1.6.0

### Patch Changes

- Updated dependencies [6f7da89]
  - @trainheroic-unofficial/dto@1.6.0
  - @trainheroic-unofficial/js@1.6.0

## 1.5.0

### Patch Changes

- Updated dependencies [dffd968]
  - @trainheroic-unofficial/dto@1.5.0
  - @trainheroic-unofficial/js@1.5.0

## 1.4.0

### Patch Changes

- Updated dependencies [b776fe2]
- Updated dependencies [b776fe2]
- Updated dependencies [b776fe2]
  - @trainheroic-unofficial/js@1.4.0
  - @trainheroic-unofficial/dto@1.4.0

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
  - @trainheroic-unofficial/dto@1.3.0
  - @trainheroic-unofficial/js@1.3.0
