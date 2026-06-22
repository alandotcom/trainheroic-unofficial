---
"@trainheroic-unofficial/cli": minor
---

Add ad-hoc session logging and date-windowed team volume.

- **Athlete ad-hoc logging** — log a session that no coach scheduled (accessory work, a makeup
  lift, an off-plan gym session). New `athlete log-session` CLI command and `athlete_log_session`
  MCP tool create or reuse a personal session for the date, add the exercises, and log their sets
  in one shot. Backed by a new `logAdHocSession` SDK orchestrator.
- **Coach log-session** — `coach log-session` / `coach_log_session` log a roster athlete's session
  by exercise (no saved-set-id hunting). The API can only log against a session already on the
  athlete's calendar, so each exercise is matched to a prescribed set; an unprescribed one fails
  and names what is prescribed. Backed by `logSessionForAthlete`.
- **Date-windowed team volume** — `coach team-volume --team <id> | --athletes <ids> --start --end`
  and the `team_volume` MCP tool report team-wide volume/reps/sessions scoped to a window, with
  per-athlete rows and rolled-up totals. The windowed counterpart to the all-time `roster-activity`
  snapshot, built on the `training-summary-athlete` analytics metric (`teamVolume` SDK helper).
