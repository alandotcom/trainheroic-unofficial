# @trainheroic-unofficial/eval

## 3.0.0

### Patch Changes

- Updated dependencies [5e3cf8e]
  - @trainheroic-unofficial/js@3.0.0
  - @trainheroic-unofficial/dto@3.0.0

## 2.1.2

### Patch Changes

- Updated dependencies [c8914cf]
  - @trainheroic-unofficial/js@2.1.2
  - @trainheroic-unofficial/dto@2.1.2

## 2.1.1

### Patch Changes

- Updated dependencies [448d5de]
  - @trainheroic-unofficial/js@2.1.1
  - @trainheroic-unofficial/dto@2.1.1

## 2.1.0

### Patch Changes

- Updated dependencies [28bb2fe]
  - @trainheroic-unofficial/js@2.1.0
  - @trainheroic-unofficial/dto@2.1.0

## 2.0.2

### Patch Changes

- Updated dependencies [d76fe73]
  - @trainheroic-unofficial/dto@2.0.2
  - @trainheroic-unofficial/js@2.0.2

## 2.0.1

### Patch Changes

- bb488b9: Bump hono to 4.13.0 (cloudflare, eval) and @hono/node-server to 2.1.0 (eval).
  - @trainheroic-unofficial/dto@2.0.1
  - @trainheroic-unofficial/js@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [627318f]
  - @trainheroic-unofficial/js@2.0.0
  - @trainheroic-unofficial/dto@2.0.0

## 1.7.4

### Patch Changes

- @trainheroic-unofficial/dto@1.7.4
- @trainheroic-unofficial/js@1.7.4

## 1.7.3

### Patch Changes

- Updated dependencies [066de31]
  - @trainheroic-unofficial/js@1.7.3
  - @trainheroic-unofficial/dto@1.7.3

## 1.7.2

### Patch Changes

- Updated dependencies [7025fbe]
  - @trainheroic-unofficial/js@1.7.2
  - @trainheroic-unofficial/dto@1.7.2

## 1.7.1

### Patch Changes

- @trainheroic-unofficial/dto@1.7.1
- @trainheroic-unofficial/js@1.7.1

## 1.7.0

### Patch Changes

- Updated dependencies [b0240c3]
  - @trainheroic-unofficial/dto@1.7.0
  - @trainheroic-unofficial/js@1.7.0

## 1.6.1

### Patch Changes

- @trainheroic-unofficial/dto@1.6.1
- @trainheroic-unofficial/js@1.6.1

## 1.6.0

### Minor Changes

- 6f7da89: feat(athlete): log-targets read, personal-session removal, and a scheduled-duplicate warning

  Closes the athlete-logging friction reported from real usage (GitHub #28, #29): logging into a coach-scheduled workout was hard to reach, and the workaround left a stray session nothing could delete.

  `athlete_log_targets` (CLI: `athlete log-targets`) is a new athlete read that returns the `savedWorkoutSetId` + `savedWorkoutSetExerciseId` that `athlete_log_set` needs, as a compact one-row-per-set view — no `raw` blob to dig through, and a `program`/`programId`/`teamId` filter to pick one workout when several fall on the same day. It mirrors the coach `athlete_saved_workouts` tool on the athlete's own surface. `athlete_log_set`'s description now points here for the ids.

  `athlete_session_remove` (CLI: `athlete session-remove`) deletes a personal (self-created) workout session — the cleanup for a stray ad-hoc log. It is gated (confirmation / `--yes`) and personal-only: it re-reads the day and refuses a coach-scheduled workout.

  `athlete_log_session` keeps its off-plan semantics but now flags when a logged lift was already on a coach-scheduled workout that day: the result carries `scheduledAlternatives` (the matching ids), the MCP tool adds a hint, and the CLI prints an advisory to stderr — pointing at `athlete_log_set` to log into the schedule, or `athlete_session_remove` to drop the personal session.

  `athlete_workouts` views now carry a `personal` flag so a stray personal session is identifiable (its `id` is what `athlete_session_remove` takes).

  The eval harness gains three scenarios for these paths (log into one of several same-day workouts, remove a stray personal session, the scheduled-duplicate warning), run on both the MCP and CLI surfaces, plus a `packages/eval/CLAUDE.md` documenting the harness.

### Patch Changes

- Updated dependencies [6f7da89]
  - @trainheroic-unofficial/dto@1.6.0
  - @trainheroic-unofficial/js@1.6.0

## 1.5.0

### Patch Changes

- Updated dependencies [dffd968]
  - @trainheroic-unofficial/dto@1.5.0
  - @trainheroic-unofficial/js@1.5.0

## 1.4.0

### Patch Changes

- Updated dependencies [b776fe2]
- Updated dependencies [b776fe2]
- Updated dependencies [b776fe2]
  - @trainheroic-unofficial/js@1.4.0
  - @trainheroic-unofficial/dto@1.4.0
