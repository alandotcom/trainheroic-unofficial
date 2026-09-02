# Athlete API reference

The athlete endpoints operate on the **logged-in user** (no athlete id in the path — the
session identifies you). Several need the numeric user id as a query arg; get it from
`GET /user/simple` (`.id`). All are on the default host `https://api.trainheroic.com` and
authenticate with the `session-token` header. Response schemas are loose (the API drifts);
only the fields below are relied on.

## Identity & profile

| Endpoint                                                        | Notes                                                                                                                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /user/simple`                                              | `id`, `roles`, `org_id`, name. The id is the tenant key for everything else.                                                                                                                   |
| `GET /v5/athleteProfile/summary?user_id={id}&use_metric={0\|1}` | Lifetime totals: `reps_sum`, `volume_sum`, `sessions_count`, `first_logged_date`, `last_logged_date`, `duration_hours`. **`use_metric` is required** — omitting it returns `400 Invalid data`. |
| `GET /v5/users/{id}`                                            | Detailed profile: dob, gender, height/weight, `use_metric`, trial status.                                                                                                                      |
| `GET /1.0/athlete/prefs`                                        | Notification + display preference flags.                                                                                                                                                       |

## Workouts

`GET /3.0/athlete/programworkout/range?startDate={Y-M-D}&endDate={Y-M-D}` — scheduled and
completed workouts in an inclusive window. Each item:

- Top level: `id` (the programWorkout id), `date`, `workout_title`, `program_id`,
  `program_title`, `team_id`, `team_title`.
- `summarizedSavedWorkout.workout`: `title`, `instruction` (coach note), `workoutSets[]`.
  - Each set: `title`, `order`, `instruction`, `is_test`, `workoutSetExercises[]`.
    - Each exercise: `exercise_id`, `title`, `instruction`, `param_1_type`, `param_2_type`,
      and the prescription in `param_1_data_1..10` / `param_2_data_1..10` (one slot per set;
      empty string for unused). Non-numeric prescriptions (`AMRAP`, `8-12`) appear as-is.
- `summarizedSavedWorkout.saved_workout`: the athlete's logged copy, with `workoutSets[]`
  (plus `addedWorkoutSets[]` for work the athlete added) whose `id` is the
  **savedWorkoutSetId** and whose `workoutSetExercises[].id` is the **savedWorkoutSetExerciseId**
  — the ids the logging write targets. Each saved exercise's `workout_set_exercise_id` points
  back at the prescription exercise's `id`.
  - The athlete's entered values live in the same `param_1_data_1..10` / `param_2_data_1..10`
    slots, but the saved copy **pre-fills those with the prescription**, so data presence does
    not mean a set was logged. The reliable per-set "performed" signal is `param_{i}_made == 1`
    (the same flag the logging write sets). The set/workout-level `completed` and
    `percent_completed` are unreliable — a session routinely holds logged sets with those left
    at 0.

The SDK's `presentAthleteWorkout` merges the two copies into `{ id, date, title, program, team,
instruction, notes, rpe, logged, blocks: [{ order, title, instruction, isTest, exercises: [{ exerciseId,
title, instruction, notes, units, prescribed, performed }] }] }`. `instruction` is the coach's session
note; `notes` / `rpe` are the athlete's own session note and RPE on `saved_workout` (null when
unset). Each exercise's `notes` is the per-exercise athlete note (null when unset). `performed` holds the per-set values
the athlete logged (made-gated; empty when nothing was recorded), `logged` is true when any
exercise has `performed` values, and athlete-added/personal work with no prescription is
appended as its own blocks. No `--raw` is needed to read logged results.

## Exercises, history, PRs

| Endpoint                                                | Notes                                                                                                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v5/users/exercises/history`                       | The exercises you've logged: `id`, `title`, `param1Type`, `param2Type`, `prescription`, `isCircuit`. Use it to find an exercise id.                                        |
| `GET /v5/exercises/{id}/history?userId={id}`            | `liftPRs[]` (rep-max PRs), `history[]` (per-session: `dateCompleted`, `abr`, `bestEstimated1RM`, `savedWorkoutSetExerciseId`, `programWorkoutId`, `sets[]`, `repMaxes[]`). |
| `GET /v5/exercises/{id}/personalRecords`                | PR rows with strength-standard `filters`.                                                                                                                                  |
| `GET /v5/exercises/{id}/stats?userId={id}&date={Y-M-D}` | `isLift`, `lastPerformance`, `personalRecord`. **`date` is required** — omitting it returns `400 Invalid date parameter`.                                                  |
| `GET /v5/exercises/{id}`                                | Exercise detail: description, `param1Type`/`param2Type`, `units`, video.                                                                                                   |
| `GET /2.0/athlete/workingMax`                           | Working max per exercise: `exercise_id`, `title`, `param_type`, `value`, `type_suffix`.                                                                                    |
| `GET /3.0/athlete/leaderboard/{workoutId}`              | Leaderboard for a benchmark/test workout (`tests`, `results`, `testStats`).                                                                                                |

## Logging a set (write)

Logging is a **two-step** write, reverse-engineered from the mobile app (verified against
captured traffic). The SDK's `logAthleteSet` performs both; it fetches the day's range to
resolve the ids from `summarizedSavedWorkout.saved_workout`.

1. **Persist the entered data** — `PUT /1.0/athlete/savedworkoutsetexercise/{savedWorkoutSetExerciseId}`
   with `{ id, saved_workout_set_id, workout_set_exercise_id, completed:1, param_N_made,
param_1_data_N, param_2_data_N (10 slots) }`. This is the only path that actually stores
   reps/weight (and it alone surfaces the result in exercise history). The
   `savedworkoutset`/`savedworkout` PUTs accept the same fields but **silently discard** the
   `param_N_data` values (the savedworkout PUT is the session-note / RPE write, not a log path).
2. **Mark the set completed** — `PUT /1.0/athlete/savedworkoutset/{savedWorkoutSetId}` with
   the camelCase in-memory model (`sessionId` ← `saved_workout.id`, `workoutSetId` ←
   `workout_set_id`, `isSuperSet`, `exercises: [savedWorkoutSetExerciseId, …]`, `completed`).
   A minimal `{id, sessionId, completed}` body returns 500 — the full mapped body is required.

3. **Session note / RPE** — `PUT /1.0/athlete/savedworkout/{savedWorkoutId}` with `{ id, notes?, rpe? }`.
   GET on that path 405s; resolve `savedWorkoutId` from the range item's
   `summarizedSavedWorkout.saved_workout.id`. A notes-only body leaves rpe untouched and vice versa.
   Empty `notes` clears the note. `session_duration` is not a field on this object (the coach
   calendar summary's duration is separate). The SDK's `setAthleteWorkoutNote` looks the saved id
   up from `date` + `programWorkoutId` (the range item's top-level `id`).

4. **Per-exercise note** — `PUT /1.0/athlete/savedworkoutsetexercise/{savedWorkoutSetExerciseId}`
   with `{ id, notes }`. A notes-only body leaves logged reps/weight untouched; empty `notes`
   clears. GET on that path 405s. The range read's saved copy and
   `GET /v5/exercises/{id}/history[].notes` both echo the stored string. Distinct from the
   session note (step 3) and from coach `instruction`. The SDK's `setAthleteExerciseNote` takes
   the slot id from `athlete_log_targets`.

There is no GET for a single saved workout set; read it from the workout range's
`saved_workout.workoutSets[]` (`id` = savedWorkoutSetId, `workoutSetExercises[].id` =
savedWorkoutSetExerciseId, `workoutSetExercises[].workout_set_exercise_id` = the template id).

## MCP tools

The local `@trainheroic-unofficial/athlete-mcp` server and the hosted worker (for any
account) expose:

- Live reads: `athlete_whoami`, `athlete_profile`, `athlete_prefs`, `athlete_workouts`,
  `athlete_exercises`, `athlete_exercise_history`, `athlete_personal_records`,
  `athlete_exercise_stats`, `athlete_working_maxes`, `athlete_leaderboard`.
- Gated writes include `athlete_log_set` for performed results, `athlete_prescribe_set` for
  planned reps/weight that must not mark a set completed, `athlete_workout_note` for the
  session note / RPE, and `athlete_exercise_note` for the per-exercise note (elicitation or
  `confirm:true`).

## Warehouse tools (hosted worker only, D1-backed)

Download historicals into D1 so they can be queried over time without re-hitting the API.
One sync verb populates each zone; one query tool reads it.

- `athlete_workouts_sync { startDate, endDate }` → `athlete_workouts_stored { workoutId? |
startDate?/endDate? }`.
- `athlete_training_sync { exerciseId? | batchSize?, full? }` → `athlete_training_stored
{ q? | exerciseId? (+prs?) | workingMaxes? }`. Omitting `exerciseId` syncs the catalog +
  working maxes and drains a **batch** of un-synced exercises (repeat until `remaining` is 0
  — bounded per call to respect Worker subrequest limits). `full:true` re-pulls every
  exercise.

## Still unexplored

Living status table: `.agents/skills/reverse-engineer-api/coverage.md`.

In-scope athlete reads are wrapped (`athlete_circuits`, `athlete_programming_programs`,
`athlete_recent_exercises`). Closed without a wrap: working-max write (read exists; set/update
never found). `PUT /1.0/athlete/savedworkout/{id}` is wrapped as the session-note / RPE write
(`athlete_workout_note`); it is not a set-logging path. `PUT /1.0/athlete/savedworkoutsetexercise/{id}`
with `{id, notes}` is the per-exercise note write (`athlete_exercise_note`); a notes-only body
does not wipe logged reps/weight.
