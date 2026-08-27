---
"@trainheroic-unofficial/dto": minor
"@trainheroic-unofficial/js": minor
"@trainheroic-unofficial/core": minor
"@trainheroic-unofficial/cli": minor
"@trainheroic-unofficial/coach-mcp": minor
"@trainheroic-unofficial/athlete-mcp": minor
"@trainheroic-unofficial/eval": minor
---

feat(athlete): add a per-exercise note on a saved slot

Athletes can write the "Add exercise note" field (band color, etc.) via
`PUT /1.0/athlete/savedworkoutsetexercise/{id}` with `{id, notes}`. Adds
SDK `setAthleteExerciseNote`, MCP `athlete_exercise_note`, and CLI
`athlete exercise-note`. Workout, log-target, and history reads surface the note.

Fixes TRAINHEROIC-MCP-X
