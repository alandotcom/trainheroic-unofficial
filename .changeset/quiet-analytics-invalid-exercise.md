---
"@trainheroic-unofficial/js": patch
---

Analytics reads (`queryAnalytics`) no longer report TrainHeroic's HTTP 400 "Invalid exercise id" rejection to the client's `onHttpError` hook. The read still throws an error that explains which exercises the metric accepts, and other analytics failures are still reported. `RequestOptions` gains `isExpectedFailure`, a predicate over the final status and parsed response body that marks a handled failure as expected.
