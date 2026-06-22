---
"@trainheroic-unofficial/dto": minor
"@trainheroic-unofficial/js": minor
"@trainheroic-unofficial/core": minor
"@trainheroic-unofficial/cli": minor
"@trainheroic-unofficial/coach-mcp": minor
"@trainheroic-unofficial/athlete-mcp": minor
---

feat(coach): prescribe reps/weight for one athlete without marking the set done

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
