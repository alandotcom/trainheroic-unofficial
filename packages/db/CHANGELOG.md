# @trainheroic-unofficial/db

## 3.6.0

### Patch Changes

- Updated dependencies [50744bc]
  - @trainheroic-unofficial/js@3.6.0
  - @trainheroic-unofficial/dto@3.6.0

## 3.5.2

### Patch Changes

- c36add1: Performance: set-logging writes (`athlete_log_set`, `log_athlete_set`, the prescribe tools, and the session-log tools) fan out their per-exercise and per-set PUTs with a small pool instead of one round trip at a time, with session failures reporting every confirmed partial write; `roster_activity` uses a true pool rather than batches that wait for their slowest member; main-lift discovery tallies performed exercises straight off the saved copies instead of building the full merged workout view for a year of sessions; the MCP result serializer serializes once for both text and structured content and stops walking an oversized list at the first element that no longer fits; the in-memory exercise library dedupes concurrent cold loads; shared collection operations use `es-toolkit`; invalid concurrency limits fail fast; the messaging warehouse syncs streams with a bounded pool; and the coach PR warehouse writes one multi-row insert per athlete.
- 38824dd: Athlete workout presenters: `presentLogTargets` now reports the coach's prescription from the template row instead of the saved copy's slots (which hold the logged values once sets are performed), and `presentAthleteWorkout` / the export honour targets held unperformed on the saved copy, so a `prescribeAthleteSet` override and a personal session's not-yet-logged sets appear as prescribed. `readSession` keeps `reps` and `load` slot-aligned (a reps-only or load-only set no longer shifts the other list) and zero-pads `date`. CLI integer arguments reject blanks and fractions, `--limit` must be positive, `athlete exercises --limit` applies to the full catalog, and the `roster-activity --metric` help text says the flag switches units. `parseWorkoutDate` rejects a blank part and an out-of-range month or day. The messaging warehouse stores a null comment image as NULL rather than the text "null"; `programming_stored` returns a superset block's sets in prescribed exercise order on every read; a `sync_state` upsert leaves a field the caller omits untouched; and the exercise library's `pruned` count is reported on the node:sqlite adapter too.
- Updated dependencies [c218865]
- Updated dependencies [c36add1]
- Updated dependencies [38824dd]
  - @trainheroic-unofficial/js@3.5.2
  - @trainheroic-unofficial/dto@3.5.2

## 3.5.1

### Patch Changes

- Updated dependencies [d2692c8]
  - @trainheroic-unofficial/js@3.5.1
  - @trainheroic-unofficial/dto@3.5.1

## 3.5.0

### Patch Changes

- Updated dependencies [385a944]
  - @trainheroic-unofficial/dto@3.5.0
  - @trainheroic-unofficial/js@3.5.0

## 3.4.0

### Patch Changes

- Updated dependencies [466e51e]
  - @trainheroic-unofficial/dto@3.4.0
  - @trainheroic-unofficial/js@3.4.0

## 3.3.3

### Patch Changes

- @trainheroic-unofficial/dto@3.3.3
  - @trainheroic-unofficial/js@3.3.3

## 3.3.2

### Patch Changes

- @trainheroic-unofficial/dto@3.3.2
  - @trainheroic-unofficial/js@3.3.2

## 3.3.1

### Patch Changes

- @trainheroic-unofficial/dto@3.3.1
  - @trainheroic-unofficial/js@3.3.1

## 3.3.0

### Patch Changes

- Updated dependencies [48fe6bc]
  - @trainheroic-unofficial/dto@3.3.0
  - @trainheroic-unofficial/js@3.3.0

## 3.2.0

### Minor Changes

- c6b63fe: Add program/exercise delete, custom-exercise update, session-template library CRUD,
  athlete circuit/program/recent-exercise reads, notifications list, subscriptions,
  prescription templates, coach-athlete-team calendar, and team auto-publish after
  live-probing the undocumented TrainHeroic paths.

### Patch Changes

- 6c2400e: Fix team auto-publish when targeting a team id: resolve `group_program` first, then GET that program. The `--team` / `teamId` path previously requested `/3.0/coach/program/undefined`.
- Updated dependencies [6c2400e]
- Updated dependencies [c6b63fe]
  - @trainheroic-unofficial/dto@3.2.0
  - @trainheroic-unofficial/js@3.2.0

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
