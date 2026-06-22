# @trainheroic-unofficial/cli

## 1.2.0

### Minor Changes

- 72bd48b: feat(coach): prescribe reps/weight for one athlete without marking the set done

  Adds a per-athlete prescription override: a coach can set the prescribed reps and/or weight on
  one of a roster athlete's scheduled sets, for that athlete only, leaving the set open (not marked
  performed) and the team/program prescription untouched. This is the API equivalent of editing an
  athlete's prescribed values in the app, and writes to the same `savedworkoutsetexercise` endpoint
  as logging but with every `param_N_made`/`completed` flag left at 0.

  Surfaces: the `prescribeForAthlete` SDK call, the `prescribe_athlete_set` MCP tool, and the
  `coach prescribe-set` CLI command. param1 is reps, param2 is weight; the write replaces the slot's
  prescribed values. Use `log_athlete_set` / `coach log-set` instead to record a set as performed.

  The internal `buildExerciseLogPayload` helper was generalized and renamed to
  `buildExerciseSetPayload`, taking a `markPerformed` flag that selects logging vs. prescribing.

- f41ac54: feat(coach): swap one exercise in a roster athlete's prescribed workout

  Adds a per-athlete exercise swap: a coach can replace one exercise in an athlete's scheduled
  team/program workout with a different one, for that athlete only, leaving the team prescription
  untouched. The new exercise carries over the slot's prescribed sets.

  Surfaces: the `swapAthleteExercise` SDK call, the `swap_athlete_exercise` MCP tool (coach
  surface, confirmation-gated), and the `coach swap-exercise --set-exercise <id> --exercise <id>
--yes` CLI command. The slot id comes from `athlete_saved_workouts` / `coach athlete-workouts
--log-ids`; the replacement exercise from `exercise_resolve` / `exercise_search`. Backed by
  `PUT /v5/savedWorkoutSetExercises/{id}?exerciseId=`; seeded demo athletes are read-only.

### Patch Changes

- 0f99401: fix(cloudflare): make hosted login and open-registration copy role-neutral

  Athletes authenticate through the same OAuth flow as coaches, but the consent page, the
  DEPLOY.md open-registration note, and the open-registration warning all framed it as
  coach-only. They now say "account" (coach or athlete) instead.

- Updated dependencies [0f99401]
- Updated dependencies [72bd48b]
- Updated dependencies [f41ac54]
  - @trainheroic-unofficial/dto@1.2.0
  - @trainheroic-unofficial/js@1.2.0

## 1.1.1

### Patch Changes

- bb0b826: docs: revise all package READMEs for a direct prose style (remove em dashes and rhetorical framing)
- Updated dependencies [bb0b826]
  - @trainheroic-unofficial/dto@1.1.1
  - @trainheroic-unofficial/js@1.1.1

## 1.1.0

### Minor Changes

- fc77165: Add ad-hoc session logging and date-windowed team volume.

  - **Athlete ad-hoc logging** — log a session that no coach scheduled (accessory work, a makeup
    lift, an off-plan gym session). New `athlete log-session` CLI command and `athlete_log_session`
    MCP tool create or reuse a personal session for the date, add the exercises, and log their sets
    in one shot. Backed by a new `logAdHocSession` SDK orchestrator.
  - **Coach log-session** — `coach log-session` / `coach_log_session` log a roster athlete's session
    by exercise (no saved-set-id hunting). The API can only log against a session already on the
    athlete's calendar, so each exercise is matched to a prescribed set; an unprescribed one fails
    and names what is prescribed. Backed by `logSessionForAthlete`.
  - **Date-windowed team volume** — `coach team-volume --team <id> | --athletes <ids> --start --end`
    and the `team_volume` MCP tool report team-wide volume/reps/sessions scoped to a window, with
    per-athlete rows and rolled-up totals. The windowed counterpart to the all-time `roster-activity`
    snapshot, built on the `training-summary-athlete` analytics metric (`teamVolume` SDK helper).

### Patch Changes

- @trainheroic-unofficial/dto@1.1.0
- @trainheroic-unofficial/js@1.1.0

## 1.0.0

### Major Changes

- 109e4ec: First stable release. The whole suite (dto, js, core, cli, coach-mcp, athlete-mcp) graduates to 1.0.0 under the shared fixed version.

### Patch Changes

- @trainheroic-unofficial/dto@1.0.0
- @trainheroic-unofficial/js@1.0.0

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
