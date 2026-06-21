# @trainheroic-unofficial/core

## 0.6.1

### Patch Changes

- Improve MCP tool usability from eval findings: add coach-side `athlete_lift_history` (a roster athlete's PR board + dated session series for one lift), add `since`/`until` date filtering to `athlete_exercise_history`, and fix `athlete_exercises` to honor `limit` when no query is given. Sharpen descriptions so all-time totals route to `athlete_profile` (not window-summing), `analytics_query` documents that `userIds` takes the whole roster in one call, and `list_teams`/`list_athletes`/`list_programs`/exercise/messaging/working-maxes clarify their semantics.
  - @trainheroic-unofficial/dto@0.6.1
  - @trainheroic-unofficial/js@0.6.1

## 0.6.0

### Minor Changes

- 6075bc4: Surface logged results in `athlete_workouts`: the presenter now merges the athlete's logged
  copy onto the prescription, so each exercise carries both `prescribed` and `performed` sets and
  each workout a top-level `logged` flag (keyed off the per-set `param_N_made` signal, since the
  API leaves completion flags at 0 on logged sessions). Adds `loggedOnly` and `limit` arguments
  (and a `selectWorkouts` SDK helper, CLI `--logged-only`/`--limit`) so "did I record anything /
  what did I do" answers in one call. The hosted warehouse mirrors this (migration 0004 adds
  `athlete_workout.logged` and `athlete_workout_exercise.performed`). Also sharpens the athlete
  history and coach analytics tool descriptions, and adds exhaustive fail-closed tests for every
  gated coach tool.

### Patch Changes

- @trainheroic-unofficial/dto@0.6.0
- @trainheroic-unofficial/js@0.6.0

## 0.5.0

### Patch Changes

- @trainheroic-unofficial/dto@0.5.0
- @trainheroic-unofficial/js@0.5.0

## 0.4.2

### Patch Changes

- Add a server `instructions` string so the host model describes actions in the app's own terms
  and stops surfacing internal tool names (e.g. `athlete_session_create`) and ids in user-facing
  replies. Each server now reports its own `package.json` version instead of a hardcoded string.
  - @trainheroic-unofficial/dto@0.4.2
  - @trainheroic-unofficial/js@0.4.2

## 0.4.1

### Patch Changes

- Updated dependencies
  - @trainheroic-unofficial/js@0.4.1
  - @trainheroic-unofficial/dto@0.4.1

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
