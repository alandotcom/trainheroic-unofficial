# @trainheroic-unofficial/dto

## 1.7.0

### Minor Changes

- b0240c3: Add athlete workout-history export. An athlete can download a full training history as CSV, JSON, or plain text, with reps and weight broken out per set.

  The SDK gains `presentAthleteWorkoutsExport` (a structured projection of a session), `serializeWorkoutHistory` (CSV/JSON/text serialization that neutralizes spreadsheet formula injection), and `fetchAthleteWorkoutsChunked` with `mergeWorkoutsById`, which window a long date range so the `programworkout/range` endpoint stops timing out on a multi-year span. The `dto` package adds the `WorkoutHistoryExport` shape. The CLI adds `athlete workouts --format json|csv|text`.

  The readable and structured athlete-workout presenters now derive from one merge, so the two views always agree on what a session contains.

## 1.6.1

## 1.6.0

### Minor Changes

- 6f7da89: feat(athlete): log-targets read, personal-session removal, and a scheduled-duplicate warning

  Closes the athlete-logging friction reported from real usage (GitHub #28, #29): logging into a coach-scheduled workout was hard to reach, and the workaround left a stray session nothing could delete.

  `athlete_log_targets` (CLI: `athlete log-targets`) is a new athlete read that returns the `savedWorkoutSetId` + `savedWorkoutSetExerciseId` that `athlete_log_set` needs, as a compact one-row-per-set view — no `raw` blob to dig through, and a `program`/`programId`/`teamId` filter to pick one workout when several fall on the same day. It mirrors the coach `athlete_saved_workouts` tool on the athlete's own surface. `athlete_log_set`'s description now points here for the ids.

  `athlete_session_remove` (CLI: `athlete session-remove`) deletes a personal (self-created) workout session — the cleanup for a stray ad-hoc log. It is gated (confirmation / `--yes`) and personal-only: it re-reads the day and refuses a coach-scheduled workout.

  `athlete_log_session` keeps its off-plan semantics but now flags when a logged lift was already on a coach-scheduled workout that day: the result carries `scheduledAlternatives` (the matching ids), the MCP tool adds a hint, and the CLI prints an advisory to stderr — pointing at `athlete_log_set` to log into the schedule, or `athlete_session_remove` to drop the personal session.

  `athlete_workouts` views now carry a `personal` flag so a stray personal session is identifiable (its `id` is what `athlete_session_remove` takes).

  The eval harness gains three scenarios for these paths (log into one of several same-day workouts, remove a stray personal session, the scheduled-duplicate warning), run on both the MCP and CLI surfaces, plus a `packages/eval/CLAUDE.md` documenting the harness.

## 1.5.0

### Patch Changes

- dffd968: fix(log-set): place partial logs in the right slots and stop completing supersets early

  Two fixes to the set-logging write (`athlete_log_set`, the coach `log_athlete_set`, and `coach`/`athlete log-set`), both reported from real usage.

  A logged set now carries an optional 1-based `slot` so a caller can place a result at a specific prescribed position — e.g. logging three top singles into positions 4–6 of an `8,5,3,1,1,1` "find a 1RM" ramp instead of into the 8/5/3 ramp positions. Omitting `slot` fills positions sequentially as before. A partial log records only the positions it sends, keeps any positions logged in an earlier call, and leaves the rest unlogged — so completing the set no longer marks untouched prescribed sets as performed. (Coach `prescribe_athlete_set` keeps its full-replacement contract and is unaffected.)

  Verified end-to-end against the live API with the test athlete: slot-targeted singles land in positions 4–6, the un-logged warm-up positions stay unmarked through set completion, and logging one exercise of a superset leaves its siblings untouched.

  In a superset/circuit, the block is marked complete only once every exercise in it has logged results (written in the call, or already logged). Logging one exercise no longer flips its siblings to "done" with empty fields — the cause of the app's "NAN LB" session total. A log that carries no values for any exercise also no longer completes the set. The log response now reports `setCompleted` so a caller can tell whether the block was closed or left open for the remaining exercises.

## 1.4.0

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
