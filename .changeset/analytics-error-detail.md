---
"@trainheroic-unofficial/js": patch
"@trainheroic-unofficial/core": patch
---

`analytics_query` errors now include TrainHeroic's response text. Before, a lift metric called with
an exercise that is not a weighted lift failed with only "Analytics lift-1rm-history failed
(HTTP 400)." The error now relays "Invalid exercise id" and explains that `exerciseId` must be a
weighted lift such as Back Squat, so an agent can correct the call.
