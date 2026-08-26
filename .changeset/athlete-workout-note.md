---
"@trainheroic-unofficial/dto": minor
"@trainheroic-unofficial/js": minor
"@trainheroic-unofficial/core": minor
"@trainheroic-unofficial/cli": minor
"@trainheroic-unofficial/eval": minor
"@trainheroic-unofficial/coach-mcp": minor
"@trainheroic-unofficial/athlete-mcp": minor
---

feat(athlete): add a session note (and optional RPE) on a workout

Athletes can leave the free-text note on a saved workout via `PUT /1.0/athlete/savedworkout/{id}`.
Adds SDK `setAthleteWorkoutNote`, MCP `athlete_workout_note`, and CLI `athlete workout-note`.
`athlete_workouts` now surfaces `notes` and `rpe` from the saved copy, distinct from coach
`instruction`.
