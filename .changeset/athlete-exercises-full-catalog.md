---
"@trainheroic-unofficial/core": patch
---

Stop `athlete_exercises` from silently truncating the exercise catalog.

The tool capped `limit` at 200 and, on a no-query call, sliced the full catalog down to whatever `limit` the model passed. A model reaching for the whole library would pass the advertised maximum (200) and get exactly 200 rows back with no signal that more existed, so an account with 322 exercises looked like it only had 200 (the missing ones only showed up via the synced warehouse). The underlying `/v5/users/exercises/history` endpoint returns the entire catalog in one response; the cap was purely in the tool layer.

The `limit` cap is removed (`jsonResult` still budget-bounds an oversized payload), and a no-query call that a `limit` clips now returns the results wrapped in the standard `__truncated` marker (`returned`/`total`/`omitted` plus a hint to re-call without `limit`), so a partial catalog can no longer read as complete. The description now states that calling with no arguments returns the athlete's full catalog and that `limit` only caps a search.
