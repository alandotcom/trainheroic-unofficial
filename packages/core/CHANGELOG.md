# @trainheroic-unofficial/core

## 1.6.1

### Patch Changes

- @trainheroic-unofficial/dto@1.6.1
- @trainheroic-unofficial/js@1.6.1

## 1.6.0

### Minor Changes

- 6f7da89: feat(athlete): log-targets read, personal-session removal, and a scheduled-duplicate warning

  Closes the athlete-logging friction reported from real usage (GitHub #28, #29): logging into a coach-scheduled workout was hard to reach, and the workaround left a stray session nothing could delete.

  `athlete_log_targets` (CLI: `athlete log-targets`) is a new athlete read that returns the `savedWorkoutSetId` + `savedWorkoutSetExerciseId` that `athlete_log_set` needs, as a compact one-row-per-set view — no `raw` blob to dig through, and a `program`/`programId`/`teamId` filter to pick one workout when several fall on the same day. It mirrors the coach `athlete_saved_workouts` tool on the athlete's own surface. `athlete_log_set`'s description now points here for the ids.

  `athlete_session_remove` (CLI: `athlete session-remove`) deletes a personal (self-created) workout session — the cleanup for a stray ad-hoc log. It is gated (confirmation / `--yes`) and personal-only: it re-reads the day and refuses a coach-scheduled workout.

  `athlete_log_session` keeps its off-plan semantics but now flags when a logged lift was already on a coach-scheduled workout that day: the result carries `scheduledAlternatives` (the matching ids), the MCP tool adds a hint, and the CLI prints an advisory to stderr — pointing at `athlete_log_set` to log into the schedule, or `athlete_session_remove` to drop the personal session.

  `athlete_workouts` views now carry a `personal` flag so a stray personal session is identifiable (its `id` is what `athlete_session_remove` takes).

  The eval harness gains three scenarios for these paths (log into one of several same-day workouts, remove a stray personal session, the scheduled-duplicate warning), run on both the MCP and CLI surfaces, plus a `packages/eval/CLAUDE.md` documenting the harness.

### Patch Changes

- Updated dependencies [6f7da89]
  - @trainheroic-unofficial/dto@1.6.0
  - @trainheroic-unofficial/js@1.6.0

## 1.5.0

### Patch Changes

- dffd968: fix(log-set): place partial logs in the right slots and stop completing supersets early

  Two fixes to the set-logging write (`athlete_log_set`, the coach `log_athlete_set`, and `coach`/`athlete log-set`), both reported from real usage.

  A logged set now carries an optional 1-based `slot` so a caller can place a result at a specific prescribed position — e.g. logging three top singles into positions 4–6 of an `8,5,3,1,1,1` "find a 1RM" ramp instead of into the 8/5/3 ramp positions. Omitting `slot` fills positions sequentially as before. A partial log records only the positions it sends, keeps any positions logged in an earlier call, and leaves the rest unlogged — so completing the set no longer marks untouched prescribed sets as performed. (Coach `prescribe_athlete_set` keeps its full-replacement contract and is unaffected.)

  Verified end-to-end against the live API with the test athlete: slot-targeted singles land in positions 4–6, the un-logged warm-up positions stay unmarked through set completion, and logging one exercise of a superset leaves its siblings untouched.

  In a superset/circuit, the block is marked complete only once every exercise in it has logged results (written in the call, or already logged). Logging one exercise no longer flips its siblings to "done" with empty fields — the cause of the app's "NAN LB" session total. A log that carries no values for any exercise also no longer completes the set. The log response now reports `setCompleted` so a caller can tell whether the block was closed or left open for the remaining exercises.

- Updated dependencies [dffd968]
  - @trainheroic-unofficial/dto@1.5.0
  - @trainheroic-unofficial/js@1.5.0

## 1.4.0

### Minor Changes

- b776fe2: fix(coach): reach a high-enrollment athlete's log ids without the raw view (#18)

  For an athlete enrolled in many programs on one day, `athlete_saved_workouts` with `raw:true`
  truncated the response to a single workout, so the `savedWorkoutSetId` / `savedWorkoutSetExerciseId`
  that `prescribe_athlete_set` and `log_athlete_set` need were unreachable for every program past the
  first — blocking prescription and logging for those athletes.

  Two changes fix it:

  - The default (non-`raw`) view of `athlete_saved_workouts` is now COMPACT — one row per saved set
    carrying the program/programId, the savedWorkoutSetId, and each exercise's savedWorkoutSetExerciseId
    (with prescribed/performed values). It stays small even for a high-enrollment athlete, so those ids
    no longer depend on the large `raw` blob that truncates. `presentLogTargets` (the SDK projection
    behind it, also surfaced by the CLI's `--log-ids`) now includes program/team identity.
  - `athlete_saved_workouts` and the CLI `coach athlete-workouts` take an optional `programId` / `teamId`
    filter (via the new `selectWorkoutsByProgram` SDK helper) to target one program's session directly.

  The `log_athlete_set`, `prescribe_athlete_set`, and `swap_athlete_exercise` tool descriptions no
  longer point at `raw:true`; they direct callers to the compact default view (and `programId` when the
  athlete is on several programs).

- b776fe2: fix(coach): filter a roster athlete's saved workouts by program name, and clarify a write error

  Two usability fixes the eval harness surfaced:

  - `athlete_saved_workouts` now accepts a `program` title substring (case-insensitive) to target one
    program's session, so a coach no longer has to side-call `list_teams` to resolve a `programId`
    first. `selectWorkoutsByProgram` gains a `programTitle` match; the CLI `coach athlete-workouts`
    gains `--program <title>` (and renames the id form to `--program-id`).
  - The set-write error thrown when a saved-copy exercise has no `workout_set_exercise_id` now states
    the id is a `savedWorkoutSetExerciseId` (not an `exercise_id`) and points back at
    `athlete_saved_workouts`, instead of the ambiguous "Could not resolve workout_set_exercise_id for
    exercise N" wording that conflated the two id types.

### Patch Changes

- b776fe2: fix(coach): steer per-date "what did they do today" reads to the date-precise tool

  An eval surfaced that a model asking "what did <athlete> do today" reached for `athlete_training`
  (a whole-month overview with no per-session date) and thrashed, instead of `athlete_saved_workouts`
  with a one-day window (which carries the date and the performed/logged sets). The capability was
  always there; the descriptions didn't point at it. Now:

  - `athlete_saved_workouts` leads with being the DATE-PRECISE coach read — pass startDate=endDate=the
    day to see what an athlete did/logged on it — rather than only "the source of log ids for writes".
  - `athlete_training` states it has NO per-session date and redirects day-specific questions to
    `athlete_saved_workouts`.

  Verified with a new eval (`coach-per-date-log`): on the weaker model the steering went from flaky
  (1/4) to reliable (4/4 on MCP, 2/2 on CLI), with a clean 2–3 call path.

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

### Patch Changes

- @trainheroic-unofficial/dto@1.1.0
- @trainheroic-unofficial/js@1.1.0

## 1.0.0

### Patch Changes

- @trainheroic-unofficial/dto@1.0.0
- @trainheroic-unofficial/js@1.0.0

## 0.6.5

### Patch Changes

- b0a0ca8: feat(core): coach "Log for Athlete" — log/edit a roster athlete's reps & weights via `PUT /1.0/coach/savedworkoutsetexercise/{id}/{athleteId}` (+ block-complete). Adds SDK `logForAthlete` / `fetchCoachAthleteWorkouts` (sharing `logAthleteSet`'s two-step write), the `log_athlete_set` + `athlete_saved_workouts` MCP tools, and the `coach log-set` / `coach athlete-workouts` CLI commands. Note: TrainHeroic's seeded demo athletes are read-only and 401 on the data write; real invited athletes persist.
- Updated dependencies [d0770f1]
  - @trainheroic-unofficial/js@0.6.5
  - @trainheroic-unofficial/dto@0.6.5

## 0.6.4

### Patch Changes

- New coach `roster_activity(athleteIds)` tool ranks a roster by actual training recency (each athlete's all-time session count and first/last logged date, sorted most-recently-active first), so "who is my most recently active athlete / who is falling behind" no longer needs an analytics fan-out off the misleading app-login signal. Backed by `fetchRosterActivity` in the SDK, which fans out the per-athlete profile summary, normalizes the API's epoch placeholder to null, and breaks recency ties by session count.
  - @trainheroic-unofficial/dto@0.6.4
  - @trainheroic-unofficial/js@0.6.4

## 0.6.3

### Patch Changes

- Eval-driven usability batch (rounds 3 / 3b). `athlete_workouts` gains a `summary` mode (one compact row per session) that ends the dense-week file offload; new coach `athlete_training(athleteId, year, month)` tool returns a roster athlete's logged month with the exercises they performed, which is also the discovery handle for picking lifts to query in `athlete_lift_history`; `list_athletes` name filter now matches each word independently ("Kyle Jones" finds "Jones, [Demo] Kyle"); plus discovery-triage and accuracy description tuning across the athlete and coach surfaces.
  - @trainheroic-unofficial/dto@0.6.3
  - @trainheroic-unofficial/js@0.6.3

## 0.6.2

### Patch Changes

- Require Node >= 24 and move the toolchain to pnpm 11. Release is now automated in CI (deploy on merge to main, publish on a version tag via npm OIDC trusted publishing).
  - @trainheroic-unofficial/dto@0.6.2
  - @trainheroic-unofficial/js@0.6.2

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
