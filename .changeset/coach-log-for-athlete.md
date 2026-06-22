---
"@trainheroic-unofficial/core": patch
---

feat(core): coach "Log for Athlete" — log/edit a roster athlete's reps & weights via `PUT /1.0/coach/savedworkoutsetexercise/{id}/{athleteId}` (+ block-complete). Adds SDK `logForAthlete` / `fetchCoachAthleteWorkouts` (sharing `logAthleteSet`'s two-step write), the `log_athlete_set` + `athlete_saved_workouts` MCP tools, and the `coach log-set` / `coach athlete-workouts` CLI commands. Note: TrainHeroic's seeded demo athletes are read-only and 401 on the data write; real invited athletes persist.
