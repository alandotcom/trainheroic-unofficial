---
"@trainheroic-unofficial/js": patch
"@trainheroic-unofficial/dto": patch
---

Keep partial exercise logs partial in supersets and circuits. `athlete_log_set` and
`log_athlete_set` now leave the exercise and parent block incomplete until every prescribed slot
has performed reps, preventing TrainHeroic from marking omitted slots or untouched sibling
exercises as performed.

Duplicate exercise entries are now rejected before any result writes, avoiding ambiguous
order-dependent replacements within one call.
