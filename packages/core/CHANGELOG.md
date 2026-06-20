# @trainheroic-unofficial/core

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
  - @trainheroic-unofficial/js@0.4.0
  - @trainheroic-unofficial/dto@0.4.0

## 0.3.0

### Minor Changes

- dbe2c63: Replace the raw `th_request` escape hatch with typed tools so the model never has to guess endpoints. Adds athlete `invite`/`archive`/`restore`, team `create`/`update`/`delete` and join-code create/delete, an `analytics_query` tool covering readiness, 1RM and working-max history, training summary, compliance, and lift progress, and session `unpublish`/`copy`/`save_as_template`. Destructive and athlete-facing actions still gate through `confirmGate`; additive writes are ungated. Request shapes were verified against the live TrainHeroic API.

### Patch Changes

- @trainheroic-unofficial/dto@0.3.0
- @trainheroic-unofficial/js@0.3.0
