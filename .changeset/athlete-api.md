---
"@trainheroic-unofficial/athlete-mcp": minor
"@trainheroic-unofficial/cloudflare": minor
"@trainheroic-unofficial/core": minor
"@trainheroic-unofficial/cli": minor
"@trainheroic-unofficial/js": minor
"@trainheroic-unofficial/dto": minor
---

Add first-class athlete API support, mirroring the coach offering.

- `dto`/`js`: schemas, fetchers, and presenters for the athlete surface (profile/summary,
  scheduled + completed workouts, per-exercise history, PRs, working maxes), plus a
  set-logging write (reverse-engineered two-step PUT, verified against the live API).
- `core`: `registerAthleteTrainingTools` — live athlete read tools and a gated
  `athlete_log_set`. (Distinct from the coach's roster `registerAthleteTools`.)
- `athlete-mcp`: a new local stdio MCP server for an athlete account.
- `cloudflare`: role-aware registration — every account gets the athlete surface plus a D1
  athlete history warehouse (`athlete_workouts_sync`/`_stored`,
  `athlete_training_sync`/`_stored`); coach accounts also keep the coaching surface.
- `cli`: an `athlete` command group and `athlete export` for dumping historicals to JSON.
- A new `trainheroic-athlete` skill.
