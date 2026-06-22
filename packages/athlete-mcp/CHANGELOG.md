# @trainheroic-unofficial/athlete-mcp

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
