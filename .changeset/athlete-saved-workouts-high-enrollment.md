---
"@trainheroic-unofficial/js": minor
"@trainheroic-unofficial/core": minor
"@trainheroic-unofficial/cli": minor
---

fix(coach): reach a high-enrollment athlete's log ids without the raw view (#18)

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
