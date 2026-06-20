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
  whose `id` is the **savedWorkoutSetId** and whose `workoutSetExercises[].id` is the
  **savedWorkoutSetExerciseId** — the ids the logging write targets.

The SDK's `presentAthleteWorkout` flattens this to `{ id, date, title, program, team,
instruction, blocks: [{ order, title, instruction, isTest, exercises: [{ exerciseId, title,
instruction, units, prescribed }] }] }`.

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
   `param_N_data` values.
2. **Mark the set completed** — `PUT /1.0/athlete/savedworkoutset/{savedWorkoutSetId}` with
   the camelCase in-memory model (`sessionId` ← `saved_workout.id`, `workoutSetId` ←
   `workout_set_id`, `isSuperSet`, `exercises: [savedWorkoutSetExerciseId, …]`, `completed`).
   A minimal `{id, sessionId, completed}` body returns 500 — the full mapped body is required.

There is no GET for a single saved workout set; read it from the workout range's
`saved_workout.workoutSets[]` (`id` = savedWorkoutSetId, `workoutSetExercises[].id` =
savedWorkoutSetExerciseId, `workoutSetExercises[].workout_set_exercise_id` = the template id).

## MCP tools

The local `@trainheroic-unofficial/athlete-mcp` server and the hosted worker (for any
account) expose:

- Live reads: `athlete_whoami`, `athlete_profile`, `athlete_prefs`, `athlete_workouts`,
  `athlete_exercises`, `athlete_exercise_history`, `athlete_personal_records`,
  `athlete_exercise_stats`, `athlete_working_maxes`, `athlete_leaderboard`.
- Gated write: `athlete_log_set` (elicitation or `confirm:true`).

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

- `PUT /1.0/athlete/savedworkout/{id}` (whole-workout sync; not needed for per-set logging,
  which uses the two-step path above).
- `GET /v5/users/circuits/{recent,history}` (circuit history; shapes mirror the exercise
  history list).
- `GET /1.0/athlete/programming/programs` (subscribed programs; empty for the test account).
