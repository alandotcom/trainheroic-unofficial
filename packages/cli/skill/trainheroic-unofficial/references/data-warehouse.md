# Warehouse store (design reference)

> **Note.** This documents the warehouse _design_ — the exercise mirror plus the
> programming/messaging history zones, the prune-vs-accumulate rule, `source`
> provenance, and the per-calendar month-window walk. That warehouse now lives in the
> hosted MCP server (`@trainheroic-unofficial/cloudflare`, D1). The CLI and the local
> server cache only the exercise library, to JSON at `~/.trainheroic/library.json`.
> The SQLite / `library_cache.py` / `*_sync.py` names below are historical; the schema
> and sync rules still apply to the hosted zones.

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
library_cache.py create '<json>'    # create a custom exercise (API) + write-through
library_cache.py forget <id>        # drop an exercise from the mirror (cache-only)
```

Programming history and messages are synced by separate scripts:

```bash
programming_sync.py            # pull every calendar into the programming zone
programming_sync.py <cal_id>   # one calendar/program id
messaging_sync.py              # pull every chat stream into the messaging zone
messaging_sync.py --full       # re-pull every stream from the beginning
messaging_sync.py <stream_id>  # one stream id
```

## Zones

The DB holds three zones that follow deliberately different rules. The split is
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

### Programming zone — implemented

`program`, `program_session`, `block`, `prescribed_set`, populated by
`programming_sync.py`.

- **Calendars to pull** = the union of `/1.0/coach/programs` (standalone) and each
  team's `group_program` from `/1.0/coach/teams`.
- **Sourced from `GET /1.0/coach/programs/edit/{cal}/{y}/{m}/1`**, walked month by
  month across a window (`MONTHS_BACK`/`MONTHS_FWD`): that endpoint returns only
  the queried month's sessions, not the whole calendar.
- **Accumulate-only** — never pruned, so it retains history even after a session
  is deleted on TrainHeroic. Each sync upserts every session and rebuilds that
  session's own blocks/sets (delete + re-insert) to absorb edits, then advances
  `sync_state('programming', <cal_id>)`. Re-running is idempotent.
- `prescribed_set` holds one row per prescribed set (the API's `param_N_data_1..10`
  slots expanded). `prescribed_set.exercise_id` is a **soft** join to
  `exercise(id)` — not an enforced FK, since the library cache may lag custom
  exercises and a sync must not fail on a cache miss.

### Messaging zone — implemented

`message_stream`, `message_comment`, populated by `messaging_sync.py`.

- **Conversations** from `GET /v5/messaging/streams` (buckets `teams`, `athletes`,
  `programs`, `coaches`). Each entry's `id` is the **stream id** — distinct from
  `teamId`/`userId` and what every other messaging call keys on; `message_stream`
  records `kind`, `team_id`, `user_id`, `last_viewed`.
- **Messages** from `GET /v5/messaging/streams/{id}/comments?lastCommentId={cursor}`,
  walked incrementally: the cursor is the highest comment id stored, written to
  `sync_state('messaging', stream_id)`, so a normal run only pulls newer comments.
  `--full` passes a blank cursor to re-pull a whole stream (the only way to refresh
  reactions/replies on already-synced comments, since the incremental call returns
  newer-than-cursor only).
- **Accumulate-only** — comments are upserted by id and never pruned, so a message
  soft-deleted on TrainHeroic is retained here as history (same rule as programming).
- `message_comment.is_author` is `0` for received messages, `1` for ones this coach
  sent. `parent_id` holds a reply's parent comment id (threaded `replies[]` are
  flattened into rows); `reactions` keeps the API's array as JSON.
- `message_send.py send` write-throughs the created comment so the store stays
  correct without a re-sync; the next `messaging_sync.py` then advances the cursor.

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
  or (as far as is known) syncable through this coach API. That is why
  there is no performance zone here.
- **Units are per-athlete.** Weights live in each athlete's own unit (metric vs.
  imperial). Normalize before any cross-athlete analytics.
- **`swaps` is empty from the bulk endpoint** — it likely only appears on
  per-exercise detail or create responses.
