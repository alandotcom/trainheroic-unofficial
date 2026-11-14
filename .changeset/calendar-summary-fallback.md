---
"@trainheroic-unofficial/js": patch
---

When TrainHeroic's coach month summary (`athlete_training`) answers HTTP 500 for an athlete, the
error now names the athlete and month and points to the date-range read
(`athlete_saved_workouts`), which still answers for athletes whose month summary fails.
