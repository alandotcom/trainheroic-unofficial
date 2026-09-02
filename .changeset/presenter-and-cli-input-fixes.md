---
"@trainheroic-unofficial/js": patch
"@trainheroic-unofficial/dto": patch
"@trainheroic-unofficial/cli": patch
"@trainheroic-unofficial/db": patch
---

Athlete workout presenters: `presentLogTargets` now reports the coach's prescription from the template row instead of the saved copy's slots (which hold the logged values once sets are performed), and `presentAthleteWorkout` / the export honour targets held unperformed on the saved copy, so a `prescribeAthleteSet` override and a personal session's not-yet-logged sets appear as prescribed. `readSession` keeps `reps` and `load` slot-aligned (a reps-only or load-only set no longer shifts the other list) and zero-pads `date`. CLI integer arguments reject blanks and fractions, `--limit` must be positive, `athlete exercises --limit` applies to the full catalog, and the `roster-activity --metric` help text says the flag switches units. `parseWorkoutDate` rejects a blank part and an out-of-range month or day. The messaging warehouse stores a null comment image as NULL rather than the text "null".
