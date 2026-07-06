---
"@trainheroic-unofficial/js": patch
---

Fix set-completion checkmark appearing when a set has a weight but no reps.
`athlete_log_set` now marks a slot performed (`param_N_made`) only when reps
(`param1`) are entered; a weight-only entry (`param2` with no `param1`) is
written as a target and stays un-made, so the app shows no green checkmark and
the exercise `completed` flag stays off. This keeps the per-row completion state
in agreement with the block-level `setCompleted` (which already required reps).
