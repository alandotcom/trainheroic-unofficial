---
"@trainheroic-unofficial/js": patch
"@trainheroic-unofficial/core": patch
"@trainheroic-unofficial/cli": patch
---

Fix `searchExerciseHistory` (and the `athlete_exercises` tool / `athlete exercises --q` command built on it) returning up to `limit` unrelated exercises for a query that matches nothing: rows are now filtered to titles carrying every query token before ranking, and a blank query returns no rows. Fix `coach athlete-lift-history --until` dropping a session whose completion date carries a time component, by sharing the `historyInRange` window helper between the SDK, the MCP tools, and the CLI.
