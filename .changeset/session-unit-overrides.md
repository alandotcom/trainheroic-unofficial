---
"@trainheroic-unofficial/js": minor
"@trainheroic-unofficial/dto": minor
"@trainheroic-unofficial/core": minor
---

Let `workout_build` and `buildSession` prescribe a unit other than an exercise's library default,
such as a percentage of max (`"secondaryUnit": "%max"`) or RPE on a built-in pounds lift like Back
Squat, or meters on the stock miles `Run`. TrainHeroic stores an inserted exercise row with the
library's param types, and keeps the requested types when the row is saved again by id, which is how
the coach web app's unit picker works.

`buildSession` resolves each stated unit to a param type (new `resolveExerciseUnits`), inserts the
rows, and saves again by id each row whose overridden slots (new `overriddenSlots`) the insert
stored in the library type. It throws when the save response is not a row list, when a sent
exercise has no matching row, or when the second save still does not keep the requested types. A
unit that differs from the default is set on the session and reported as an advisory note. An
explicit `param_N_type` on a slot without values is ignored with a warning, so that slot keeps the
library default as before. The build still fails before writing when a unit is unknown, conflicts
with an explicit `param_N_type`, or is `sec` or `in` without a `param_N_type` (each names two
TrainHeroic types).
