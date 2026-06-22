---
"@trainheroic-unofficial/cli": patch
---

feat(cli): full coach-command parity with the MCP tools, plus a shared SDK layer. New `coach` commands: `roster-activity`, `athlete-training`, `athlete-lift-history`, `athlete-workouts`, `log-set`, `athlete-invite`/`athlete-archive`/`athlete-restore`, `team-create`/`team-update`/`team-delete`, `team-code-create`/`team-code-delete`, `session-copy`/`session-unpublish`/`session-save-template`, and `analytics-query`; plus `athlete workouts --summary`. The logic-bearing operations (two-step athlete invite, session-copy date math, the analytics metric catalog) now live in the SDK (`@trainheroic-unofficial/js`: `inviteAthletes`, `copySession`, `queryAnalytics`/`ANALYTICS_METRIC_KEYS`) and are shared by both the MCP tools and the CLI; adds a `definedProps` helper to drop undefined keys under exactOptionalPropertyTypes. Skill docs updated.
