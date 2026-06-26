---
"@trainheroic-unofficial/dto": patch
"@trainheroic-unofficial/js": patch
"@trainheroic-unofficial/core": patch
"@trainheroic-unofficial/cli": patch
---

fix(log-set): place partial logs in the right slots and stop completing supersets early

Two fixes to the set-logging write (`athlete_log_set`, the coach `log_athlete_set`, and `coach`/`athlete log-set`), both reported from real usage.

A logged set now carries an optional 1-based `slot` so a caller can place a result at a specific prescribed position — e.g. logging three top singles into positions 4–6 of an `8,5,3,1,1,1` "find a 1RM" ramp instead of into the 8/5/3 ramp positions. Omitting `slot` fills positions sequentially as before. A partial log records only the positions it sends, keeps any positions logged in an earlier call, and leaves the rest unlogged — so completing the set no longer marks untouched prescribed sets as performed. (Coach `prescribe_athlete_set` keeps its full-replacement contract and is unaffected.)

Verified end-to-end against the live API with the test athlete: slot-targeted singles land in positions 4–6, the un-logged warm-up positions stay unmarked through set completion, and logging one exercise of a superset leaves its siblings untouched.

In a superset/circuit, the block is marked complete only once every exercise in it has logged results (written in the call, or already logged). Logging one exercise no longer flips its siblings to "done" with empty fields — the cause of the app's "NAN LB" session total. A log that carries no values for any exercise also no longer completes the set. The log response now reports `setCompleted` so a caller can tell whether the block was closed or left open for the remaining exercises.
