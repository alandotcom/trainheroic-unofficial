# @trainheroic-unofficial/cli

## 0.6.5

### Patch Changes

- 9d31d0e: feat(cli): full coach-command parity with the MCP tools, plus a shared SDK layer. New `coach` commands: `roster-activity`, `athlete-training`, `athlete-lift-history`, `athlete-workouts`, `log-set`, `athlete-invite`/`athlete-archive`/`athlete-restore`, `team-create`/`team-update`/`team-delete`, `team-code-create`/`team-code-delete`, `session-copy`/`session-unpublish`/`session-save-template`, and `analytics-query`; plus `athlete workouts --summary`. The logic-bearing operations (two-step athlete invite, session-copy date math, the analytics metric catalog) now live in the SDK (`@trainheroic-unofficial/js`: `inviteAthletes`, `copySession`, `queryAnalytics`/`ANALYTICS_METRIC_KEYS`) and are shared by both the MCP tools and the CLI; adds a `definedProps` helper to drop undefined keys under exactOptionalPropertyTypes. Skill docs updated.
- d0770f1: fix(cli,js): eval-driven usability fixes for the coach/athlete write surface. `log-set`'s "set not found on this date" error now lists the `savedWorkoutSetId`s and exercise ids actually present on that date (the dominant Haiku confusion — agents could not tell which raw id maps to `--set`), and a coach write that 401s now names the demo/seeded read-only cause. New `--log-ids` projection on `coach athlete-workouts` / `athlete workouts` (`presentLogTargets` in `js`) prints just the `savedWorkoutSetId` + `savedWorkoutSetExerciseId` log-set needs, instead of grepping the full `--raw` payload. `coach athlete-workouts` gains `--logged-only`/`--summary` (parity with `athlete workouts`); `analytics-query` with no `--metric` prints a metric catalog (scope + required params) via `analyticsMetricCatalog`, and HELP signposts that team training volume lives in `roster-activity --metric`. Empty `athlete-training`/`athlete-lift-history` results carry an explanatory note, and the help text frames the three athlete-data reads as distinct lenses. Drove mean Haiku confusion from 2.45 to ~1.7 (see `docs/cli-evals/2026-06-21.md`).
  </content>
- Updated dependencies [d0770f1]
  - @trainheroic-unofficial/js@0.6.5
  - @trainheroic-unofficial/dto@0.6.5

## 0.6.4

### Patch Changes

- @trainheroic-unofficial/dto@0.6.4
- @trainheroic-unofficial/js@0.6.4

## 0.6.3

### Patch Changes

- @trainheroic-unofficial/dto@0.6.3
- @trainheroic-unofficial/js@0.6.3

## 0.6.2

### Patch Changes

- @trainheroic-unofficial/dto@0.6.2
- @trainheroic-unofficial/js@0.6.2

## 0.6.1

### Patch Changes

- @trainheroic-unofficial/dto@0.6.1
- @trainheroic-unofficial/js@0.6.1

## 0.6.0

### Patch Changes

- @trainheroic-unofficial/dto@0.6.0
- @trainheroic-unofficial/js@0.6.0

## 0.5.0

### Minor Changes

- CLI: move all coaching commands under a `coach` namespace (`coach athletes`, `coach programs`, `coach teams`, `coach exercise …`, `coach workout …`, `coach message …`), mirroring the existing `athlete` group; `whoami` and `request` stay top-level. This is a breaking change to the command surface. Add a `trainheroic skill` command that prints the bundled usage guide and copy-paste workout-spec examples to stdout (`--full` also prints the API and workout-creation reference docs), surfaced from a "Start here" pointer in `--help` and from the `coach workout build` validation error. Documentation: rewrite the SDK and workspace READMEs (install/usage examples, MCP and credential context, prerequisites) and update the coach skill to the `coach` namespace.

### Patch Changes

- @trainheroic-unofficial/dto@0.5.0
- @trainheroic-unofficial/js@0.5.0

## 0.4.2

### Patch Changes

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

### Patch Changes

- @trainheroic-unofficial/dto@0.3.0
- @trainheroic-unofficial/js@0.3.0
