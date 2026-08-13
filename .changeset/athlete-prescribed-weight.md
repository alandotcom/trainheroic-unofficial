---
"@trainheroic-unofficial/dto": minor
"@trainheroic-unofficial/js": minor
"@trainheroic-unofficial/core": minor
"@trainheroic-unofficial/cli": minor
"@trainheroic-unofficial/coach-mcp": minor
"@trainheroic-unofficial/athlete-mcp": minor
---

feat(athlete): set planned reps or weight without logging the set

Adds `prescribeAthleteSet` to the SDK, `athlete_prescribe_set` to the MCP athlete surface, and
`athlete prescribe-set` to the CLI. The write updates the logged-in athlete's prescription while
leaving every performed/completion flag clear, so an assistant can record a target load before the
workout without falsely adding a completed set to exercise history.
