---
"@trainheroic-unofficial/dto": minor
"@trainheroic-unofficial/js": minor
"@trainheroic-unofficial/cli": minor
---

Add athlete workout-history export. An athlete can download a full training history as CSV, JSON, or plain text, with reps and weight broken out per set.

The SDK gains `presentAthleteWorkoutsExport` (a structured projection of a session), `serializeWorkoutHistory` (CSV/JSON/text serialization that neutralizes spreadsheet formula injection), and `fetchAthleteWorkoutsChunked` with `mergeWorkoutsById`, which window a long date range so the `programworkout/range` endpoint stops timing out on a multi-year span. The `dto` package adds the `WorkoutHistoryExport` shape. The CLI adds `athlete workouts --format json|csv|text`.

The readable and structured athlete-workout presenters now derive from one merge, so the two views always agree on what a session contains.
