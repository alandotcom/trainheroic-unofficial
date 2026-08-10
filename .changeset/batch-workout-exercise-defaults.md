---
"@trainheroic-unofficial/js": major
---

Batch exercise-default lookups while building workouts so hosted sessions no longer issue one
database query per exercise for unit advisories.

BREAKING: `ExerciseIndex` implementations must replace `defaults(id)` with the required
`defaultsMany(ids)` bulk lookup.
