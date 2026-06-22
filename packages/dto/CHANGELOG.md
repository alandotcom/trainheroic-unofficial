# @trainheroic-unofficial/dto

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

## 1.1.1

### Patch Changes

- bb0b826: docs: revise all package READMEs for a direct prose style (remove em dashes and rhetorical framing)

## 1.1.0

## 1.0.0

## 0.6.5

## 0.6.4

## 0.6.3

## 0.6.2

## 0.6.1

## 0.6.0

## 0.5.0

## 0.4.2

## 0.4.1

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

## 0.3.0
