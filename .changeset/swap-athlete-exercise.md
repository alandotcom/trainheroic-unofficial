---
"@trainheroic-unofficial/dto": minor
"@trainheroic-unofficial/js": minor
"@trainheroic-unofficial/core": minor
"@trainheroic-unofficial/cli": minor
"@trainheroic-unofficial/coach-mcp": minor
"@trainheroic-unofficial/athlete-mcp": minor
---

feat(coach): swap one exercise in a roster athlete's prescribed workout

Adds a per-athlete exercise swap: a coach can replace one exercise in an athlete's scheduled
team/program workout with a different one, for that athlete only, leaving the team prescription
untouched. The new exercise carries over the slot's prescribed sets.

Surfaces: the `swapAthleteExercise` SDK call, the `swap_athlete_exercise` MCP tool (coach
surface, confirmation-gated), and the `coach swap-exercise --set-exercise <id> --exercise <id>
--yes` CLI command. The slot id comes from `athlete_saved_workouts` / `coach athlete-workouts
--log-ids`; the replacement exercise from `exercise_resolve` / `exercise_search`. Backed by
`PUT /v5/savedWorkoutSetExercises/{id}?exerciseId=`; seeded demo athletes are read-only.
