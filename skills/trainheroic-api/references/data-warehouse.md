# Local store (`library_cache.py`)

`library_cache.py` manages a SQLite database at `~/.trainheroic/library.db`
(mode 0600, outside any repo). It is both a read-through cache for exercise
lookups and a durable local store any future tool can open and query directly.
Stdlib `sqlite3` only — no dependencies.

Import it as a module (`from library_cache import ExerciseCache`) or use the CLI:

```bash
library_cache.py resolve "<name>"   # name -> exercise (exit 3 + candidates if ambiguous)
library_cache.py search  "<query>"  # ranked FTS search
library_cache.py get <id>           # one exercise as JSON
library_cache.py sync [--force]     # refresh the reference mirror from the API
library_cache.py stats              # row counts per zone + cursors
library_cache.py cursors            # the sync_state watermark table
```

## Zones

The DB holds two zones that follow deliberately different rules. The split is
load-bearing: applying the reference zone's prune logic to records would silently
delete history on a short fetch window.

### Reference zone — implemented

`exercise`, `tag`, `exercise_tag`, `swap`, `exercise_fts` (FTS5 over titles).

- Sourced from `GET /v5/exerciseLibrary/all` plus the tag endpoints.
- **Read-through with a 7-day TTL.** `ensure_fresh()` backfills when the DB is
  empty or stale; a `resolve` miss forces one refresh and retries (catches
  exercises added through the web UI out of band).
- **Prune-to-match.** Each full sync bumps a generation counter; rows the API no
  longer returns are deleted — but only when the response has at least
  `PRUNE_FLOOR` (100) rows, so a thin/garbled response never wipes the mirror.
- **Write-through hooks** `record_upsert(ex)` / `record_delete(id)` keep the
  mirror correct after a create/update/delete without a full re-sync.
- IDs follow the API's own integers (Back Squat = 1, Bench Press = 1162);
  id-less entries are skipped (this is the ~2384 → 2371 gap).

### Programming zone — schema scaffolding only

`program`, `program_session`, `block`, `prescribed_set`.

- Tables and indexes exist; **nothing populates them yet.** They are forward
  scaffolding for mirroring a coach's prescribed programming.
- **Accumulate-only** — never pruned. A future programming sync should upsert by
  primary key and advance a `sync_state` cursor.

## `sync_state` — incremental watermarks

One row per `(resource, scope_id)` — `scope_id` is an athlete/program id, or 0
for global. Columns: `cursor` (ISO date / high-water mark), `synced_at`,
`generation` (set only for prune-to-match zones). The library sync writes a
`library` cursor. Any new incremental sync must record its watermark here, not in
`sync_meta` (which holds only the library TTL timestamp and generation counter).

## Conventions for extending the store

- **Source tagging.** Every records table has `source` (default `'api'`). Write
  synthetic/test rows with `source='seed'` so production queries can filter them
  and a re-seed can delete only its own rows.
- **Pick the right zone rule.** Reference-style catalogs may prune-to-match;
  anything historical must accumulate.

## Known limitations

- **No API write path for performance history.** Logged sets, readiness, and
  working-max data are produced by the athlete mobile app; they are not creatable
  or (as far as reverse-engineered) syncable through this coach API. That is why
  there is no performance zone here.
- **Units are per-athlete.** Weights live in each athlete's own unit (metric vs.
  imperial). Normalize before any cross-athlete analytics.
- **`swaps` is empty from the bulk endpoint** — it likely only appears on
  per-exercise detail or create responses.
