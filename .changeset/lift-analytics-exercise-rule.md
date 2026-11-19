---
"@trainheroic-unofficial/js": patch
"@trainheroic-unofficial/core": patch
---

`analytics_query` checks `exerciseId` against the exercise library before it calls the exercise analytics (`lift-1rm-history`, `working-max-history`, `lift-progress-team`). TrainHeroic charts only exercises recorded as a load lifted for reps, and a live probe of every param-type pair showed the rule: slot 1 is weight, or slot 1 is reps or unset and slot 2 is lb, %max, or the kettlebell load code. Loaded carries and holds such as KB Farmer's Walk ([ft, lb]) and Step Up (Goblet) ([sec, lb]) are rejected even though they are weighted. A mirrored exercise outside that rule now gets a tool error naming the exercise and its units, with no upstream request. The SDK exports the rule as `supportsLiftAnalytics` and `analyticsMetricUsesExercise`, and the tool description and the "Invalid exercise id" hint state the rule in exercise_search units.
