---
"@trainheroic-unofficial/js": patch
"@trainheroic-unofficial/core": patch
"@trainheroic-unofficial/db": patch
---

Performance: set-logging writes (`athlete_log_set`, `log_athlete_set`, the prescribe tools, and the session-log tools) fan out their per-exercise and per-set PUTs with a small pool instead of one round trip at a time; `roster_activity` uses a true pool rather than batches that wait for their slowest member; main-lift discovery tallies performed exercises straight off the saved copies instead of building the full merged workout view for a year of sessions; the MCP result serializer serializes once for both text and structured content and stops walking an oversized list at the first element that no longer fits; the in-memory exercise library dedupes concurrent cold loads; the messaging warehouse syncs streams with a bounded pool; and the coach PR warehouse writes one multi-row insert per athlete.
