---
"@trainheroic-unofficial/core": patch
---

fix(coach): steer per-date "what did they do today" reads to the date-precise tool

An eval surfaced that a model asking "what did <athlete> do today" reached for `athlete_training`
(a whole-month overview with no per-session date) and thrashed, instead of `athlete_saved_workouts`
with a one-day window (which carries the date and the performed/logged sets). The capability was
always there; the descriptions didn't point at it. Now:

- `athlete_saved_workouts` leads with being the DATE-PRECISE coach read — pass startDate=endDate=the
  day to see what an athlete did/logged on it — rather than only "the source of log ids for writes".
- `athlete_training` states it has NO per-session date and redirects day-specific questions to
  `athlete_saved_workouts`.

Verified with a new eval (`coach-per-date-log`): on the weaker model the steering went from flaky
(1/4) to reliable (4/4 on MCP, 2/2 on CLI), with a clean 2–3 call path.
