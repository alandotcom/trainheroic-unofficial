---
"@trainheroic-unofficial/js": patch
---

The coach month-summary read (`fetchCoachAthleteCalendarSummary`) no longer reports TrainHeroic's known HTTP 500 to the client's `onHttpError` hook. The read still throws `CoachMonthSummaryError` for that status, and other HTTP failures are still reported.
