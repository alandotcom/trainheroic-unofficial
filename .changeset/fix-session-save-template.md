---
"@trainheroic-unofficial/js": patch
"@trainheroic-unofficial/dto": patch
"@trainheroic-unofficial/core": patch
"@trainheroic-unofficial/cli": patch
---

Fix `session_save_as_template` and `coach session-save-template`, which failed with HTTP 500 for
every caller. TrainHeroic's `saveWorkoutAsTemplate/{workoutId}` endpoint also needs a body whose
`id` is the session's programWorkout id; the tool sent no body. The new SDK function
`saveSessionAsTemplate(client, { workoutId, pwId, title })` sends `{ id: pwId, title }`, and the
tool and CLI command now take `workoutId`, `pwId`, and `title` (`--workout`, `--pw`, `--title`).
`workout_read` and `readSession` now return the session's `workoutId`, so a session found on a
calendar date has both ids.
