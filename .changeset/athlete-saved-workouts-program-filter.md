---
"@trainheroic-unofficial/js": minor
"@trainheroic-unofficial/core": minor
"@trainheroic-unofficial/cli": minor
---

fix(coach): filter a roster athlete's saved workouts by program name, and clarify a write error

Two usability fixes the eval harness surfaced:

- `athlete_saved_workouts` now accepts a `program` title substring (case-insensitive) to target one
  program's session, so a coach no longer has to side-call `list_teams` to resolve a `programId`
  first. `selectWorkoutsByProgram` gains a `programTitle` match; the CLI `coach athlete-workouts`
  gains `--program <title>` (and renames the id form to `--program-id`).
- The set-write error thrown when a saved-copy exercise has no `workout_set_exercise_id` now states
  the id is a `savedWorkoutSetExerciseId` (not an `exercise_id`) and points back at
  `athlete_saved_workouts`, instead of the ambiguous "Could not resolve workout_set_exercise_id for
  exercise N" wording that conflated the two id types.
