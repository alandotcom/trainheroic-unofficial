---
"@trainheroic-unofficial/core": minor
---

Surface logged results in `athlete_workouts`: the presenter now merges the athlete's logged
copy onto the prescription, so each exercise carries both `prescribed` and `performed` sets and
each workout a top-level `logged` flag (keyed off the per-set `param_N_made` signal, since the
API leaves completion flags at 0 on logged sessions). Adds `loggedOnly` and `limit` arguments
(and a `selectWorkouts` SDK helper, CLI `--logged-only`/`--limit`) so "did I record anything /
what did I do" answers in one call. The hosted warehouse mirrors this (migration 0004 adds
`athlete_workout.logged` and `athlete_workout_exercise.performed`). Also sharpens the athlete
history and coach analytics tool descriptions, and adds exhaustive fail-closed tests for every
gated coach tool.
