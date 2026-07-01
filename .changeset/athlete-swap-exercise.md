---
"@trainheroic-unofficial/core": minor
"@trainheroic-unofficial/cli": minor
---

Let an athlete substitute a prescribed exercise in a coach-scheduled workout. closes #44

The athlete surface gains `athlete_swap_exercise` (MCP) and `athlete swap-exercise` (CLI), the self-service counterpart to the coach's `swap_athlete_exercise`. An athlete reads a slot's `savedWorkoutSetExerciseId` from `athlete_log_targets` and a replacement exercise id from `athlete_exercises`, then swaps the movement in a non-personal (coach-scheduled) session for their own copy only — the team/program prescription is untouched. Previously the athlete write surface could log results into a prescribed slot but never change which exercise the slot was, so an in-app substitution had no representation through the integration.

Both surfaces reuse the existing SDK `swapAthleteExercise` and the `swapAthleteExerciseArgsSchema` shape, and the write is gated the same way as the other athlete-facing writes (elicitation or `confirm: true` / `--yes`).
