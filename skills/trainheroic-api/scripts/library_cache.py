#!/usr/bin/env python3
"""Local read-through cache of the TrainHeroic exercise library.

The exercise library (~2400 entries) is large and near-static: standard
exercises keep stable ids (Back Squat is always 1, Bench Press 1162), and the
only churn is a coach's own custom exercises. Pulling the whole
`/v5/exerciseLibrary/all` payload on every name->id lookup is wasteful, so this
module mirrors the library into SQLite and serves lookups locally.

Read-through model
------------------
TrainHeroic exposes the library only as one bulk endpoint (there is no
GET /exercise/{id}), so the cache unit is the whole library. A lookup calls
`ensure_fresh()` first: if the DB is empty or older than the TTL it backfills
from the API, then reads from SQLite. A name that still misses triggers one
forced refresh and retry, which covers exercises added through the web UI out
of band. Writes (create/update/delete) update the single affected row so the
cache stays correct without a full re-sync.

The SQLite file at ~/.trainheroic/library.db is the durable, portable artifact:
any future app can open it directly, in any language.

CLI
---
  library_cache.py sync [--force]        # refresh the mirror from the API
  library_cache.py resolve "<name>"      # name -> exercise id (read-through)
  library_cache.py search "<query>"      # ranked fuzzy search
  library_cache.py get <id>              # one exercise as JSON
  library_cache.py stats                 # row counts per zone + cursors
  library_cache.py cursors               # the sync_state watermark table
  library_cache.py create '<json>'       # create a custom exercise (API) + write-through
  library_cache.py forget <id>           # drop an exercise from the mirror (cache-only)

This module is import-friendly: `from library_cache import ExerciseCache`.
"""

import json
import os
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import th_client  # noqa: E402  (reused auth + request layer)

DEFAULT_DB = Path.home() / ".trainheroic" / "library.db"
LIBRARY_PATH = "/v5/exerciseLibrary/all"
TAG_PATHS = {
    3: "/2.0/coach/tags/getByType/3",  # exercise category
    4: "/2.0/coach/tags/getByType/4",  # training effect
}
DEFAULT_TTL = 7 * 24 * 3600  # 7 days; the library barely moves
SCHEMA_VERSION = 1
# A real full library has thousands of rows; refuse to prune the mirror down to
# a sliver on a partial/garbled response.
PRUNE_FLOOR = 100

SCHEMA = """
CREATE TABLE IF NOT EXISTS exercise (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  param_1_type  INTEGER,
  param_2_type  INTEGER,
  is_circuit    INTEGER DEFAULT 0,
  type          INTEGER,
  can_edit      INTEGER DEFAULT 0,
  user_id       INTEGER,
  use_count     INTEGER DEFAULT 0,
  instruction   TEXT,
  video_url     TEXT,
  points_of_performance TEXT,
  reference_max_exercise_id          INTEGER,
  trainheroic_reference_exercise_id  INTEGER,
  raw           TEXT,
  last_seen_sync INTEGER
);
CREATE TABLE IF NOT EXISTS tag (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, type INTEGER
);
CREATE TABLE IF NOT EXISTS exercise_tag (
  exercise_id INTEGER, tag_id INTEGER, PRIMARY KEY (exercise_id, tag_id)
);
CREATE TABLE IF NOT EXISTS swap (
  exercise_id INTEGER, swap_exercise_id INTEGER,
  PRIMARY KEY (exercise_id, swap_exercise_id)
);
CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS exercise_fts USING fts5(title, ex_id UNINDEXED);
CREATE INDEX IF NOT EXISTS idx_exercise_custom ON exercise(can_edit);
CREATE INDEX IF NOT EXISTS idx_exercise_param ON exercise(param_1_type, param_2_type);
"""

# Records zones live in the same DB but follow different rules than the
# reference mirror: they accumulate, sync incrementally by watermark, and are
# never auto-pruned. `source` distinguishes API-sourced rows from test seeds.
RECORDS_SCHEMA = """
-- One cursor per (resource, scope). scope_id = athlete/program id, or 0 global.
CREATE TABLE IF NOT EXISTS sync_state (
  resource   TEXT,
  scope_id   INTEGER DEFAULT 0,
  cursor     TEXT,            -- ISO date / high-water mark
  synced_at  REAL,
  generation INTEGER,         -- set only for prune-to-match zones (library)
  PRIMARY KEY (resource, scope_id)
);

-- Programming zone: what the coach prescribed, over time.
CREATE TABLE IF NOT EXISTS program (
  id INTEGER PRIMARY KEY, title TEXT, description TEXT,
  length_weeks INTEGER, created_at TEXT, raw TEXT, source TEXT DEFAULT 'api'
);
CREATE TABLE IF NOT EXISTS program_session (
  id INTEGER PRIMARY KEY, program_id INTEGER, day_index INTEGER, date TEXT,
  title TEXT, published INTEGER DEFAULT 0, raw TEXT, source TEXT DEFAULT 'api'
);
CREATE TABLE IF NOT EXISTS block (
  id INTEGER PRIMARY KEY, program_session_id INTEGER, ord INTEGER,
  type INTEGER, title TEXT, instruction TEXT, raw TEXT, source TEXT DEFAULT 'api'
);
CREATE TABLE IF NOT EXISTS prescribed_set (
  id INTEGER PRIMARY KEY, block_id INTEGER,
  exercise_id INTEGER,   -- soft join to exercise(id); the library is a cache and may lag
  set_index INTEGER,
  param_1_type INTEGER, param_1_value REAL,
  param_2_type INTEGER, param_2_value REAL,
  raw TEXT, source TEXT DEFAULT 'api'
);

CREATE INDEX IF NOT EXISTS idx_block_session ON block(program_session_id);
CREATE INDEX IF NOT EXISTS idx_pset_block ON prescribed_set(block_id);
CREATE INDEX IF NOT EXISTS idx_psession_program ON program_session(program_id);
"""

# Columns mirrored straight from an exercise object.
_SCALAR_COLS = (
    "id", "title", "param_1_type", "param_2_type", "is_circuit", "type",
    "can_edit", "user_id", "use_count", "instruction", "video_url",
    "points_of_performance", "reference_max_exercise_id",
    "trainheroic_reference_exercise_id",
)


def _eprint(*args):
    print(*args, file=sys.stderr)


def _unwrap(body):
    """Strip the {"success":1,"data":X} envelope some endpoints use."""
    if isinstance(body, dict) and "data" in body and set(body) <= {"success", "data", "message", "error"}:
        return body["data"]
    return body


def _as_exercise_list(body):
    """Pull the exercise array out of whatever shape the bulk endpoint returns."""
    body = _unwrap(body)
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        items = []
        for key in ("exercises", "circuits", "workoutCircuits", "library", "items", "results"):
            value = body.get(key)
            if isinstance(value, list):
                items.extend(value)
        if items:
            return items
        # Last resort: a map of id -> object.
        if all(isinstance(v, dict) for v in body.values()) and body:
            return list(body.values())
    return []


def _as_tag_list(body):
    body = _unwrap(body)
    if isinstance(body, dict):
        body = body.get("tags", body)
    return body if isinstance(body, list) else []


def _coerce_int(value):
    if isinstance(value, bool):
        return int(value)
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class ExerciseCache:
    def __init__(self, db_path=DEFAULT_DB, ttl=DEFAULT_TTL):
        self.db_path = Path(db_path)
        self.ttl = ttl
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self._init_schema()

    # -- schema / meta -------------------------------------------------------

    def _init_schema(self):
        self.conn.executescript(SCHEMA)
        self.conn.executescript(RECORDS_SCHEMA)
        if self._meta("schema_version") is None:
            self._set_meta("schema_version", str(SCHEMA_VERSION))
        self.conn.commit()
        try:
            self.db_path.chmod(0o600)
        except OSError:
            pass

    def _meta(self, key, default=None):
        row = self.conn.execute("SELECT value FROM sync_meta WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default

    def _set_meta(self, key, value):
        self.conn.execute(
            "INSERT INTO sync_meta(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, str(value)),
        )

    def is_stale(self):
        last = self._meta("last_full_sync")
        if last is None:
            return True
        return (time.time() - float(last)) > self.ttl

    # -- sync_state: first-class watermarks ----------------------------------

    def get_cursor(self, resource, scope_id=0):
        row = self.conn.execute(
            "SELECT * FROM sync_state WHERE resource=? AND scope_id=?",
            (resource, scope_id),
        ).fetchone()
        return dict(row) if row else None

    def set_cursor(self, resource, scope_id=0, cursor=None, generation=None):
        self.conn.execute(
            "INSERT INTO sync_state (resource, scope_id, cursor, synced_at, generation) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(resource, scope_id) DO UPDATE SET "
            "cursor=excluded.cursor, synced_at=excluded.synced_at, generation=excluded.generation",
            (resource, scope_id, cursor, time.time(), generation),
        )

    def cursors(self):
        rows = self.conn.execute(
            "SELECT resource, scope_id, cursor, synced_at, generation FROM sync_state "
            "ORDER BY resource, scope_id"
        ).fetchall()
        return [dict(r) for r in rows]

    def count(self):
        return self.conn.execute("SELECT COUNT(*) AS n FROM exercise").fetchone()["n"]

    # -- freshness / refresh -------------------------------------------------

    def ensure_fresh(self, force=False):
        if force or self.count() == 0 or self.is_stale():
            self.refresh()

    def refresh(self):
        """Full re-sync of library + tags, with generation-based reconciliation."""
        exercises = _as_exercise_list(self._api_get(LIBRARY_PATH))
        if not exercises:
            raise RuntimeError(
                "Exercise library fetch returned no rows; refusing to wipe the cache."
            )

        generation = int(self._meta("sync_generation", "0")) + 1
        cur = self.conn
        try:
            cur.execute("BEGIN")
            # exercise_tag/swap are derived; rebuild them wholesale.
            cur.execute("DELETE FROM exercise_tag")
            cur.execute("DELETE FROM swap")
            for ex in exercises:
                self._upsert_exercise(ex, generation)

            # Prune rows the API no longer returns, guarded against a thin response.
            if len(exercises) >= PRUNE_FLOOR:
                gone = cur.execute(
                    "SELECT id FROM exercise WHERE last_seen_sync < ?", (generation,)
                ).fetchall()
                for row in gone:
                    self._delete_exercise_rows(row["id"])
                pruned = len(gone)
            else:
                pruned = 0

            self._sync_tag_catalog()
            self._set_meta("sync_generation", generation)
            self._set_meta("last_full_sync", time.time())
            # Mirror into the unified watermark table so every zone is visible there.
            self.set_cursor("library", 0, cursor=None, generation=generation)
            cur.execute("COMMIT")
        except Exception:
            cur.execute("ROLLBACK")
            raise

        return {"synced": len(exercises), "pruned": pruned, "generation": generation}

    def _api_get(self, path):
        status, body = th_client.request("GET", path)
        if not (200 <= status < 300):
            raise RuntimeError(f"GET {path} failed (HTTP {status}): {body}")
        return body

    # -- row writes ----------------------------------------------------------

    def _upsert_exercise(self, ex, generation):
        if not isinstance(ex, dict) or ex.get("id") is None:
            return
        ex_id = _coerce_int(ex.get("id"))
        values = {col: ex.get(col) for col in _SCALAR_COLS}
        values["id"] = ex_id
        values["is_circuit"] = _coerce_int(ex.get("is_circuit")) or 0
        values["can_edit"] = _coerce_int(ex.get("can_edit")) or 0
        values["title"] = ex.get("title") or ""
        values["raw"] = json.dumps(ex)
        values["last_seen_sync"] = generation

        cols = list(values.keys())
        placeholders = ", ".join("?" for _ in cols)
        updates = ", ".join(f"{c}=excluded.{c}" for c in cols if c != "id")
        self.conn.execute(
            f"INSERT INTO exercise ({', '.join(cols)}) VALUES ({placeholders}) "
            f"ON CONFLICT(id) DO UPDATE SET {updates}",
            [values[c] for c in cols],
        )

        # FTS row mirrors title; keep it 1:1 with the exercise.
        self.conn.execute("DELETE FROM exercise_fts WHERE ex_id=?", (ex_id,))
        self.conn.execute(
            "INSERT INTO exercise_fts (title, ex_id) VALUES (?, ?)",
            (values["title"], ex_id),
        )

        for tag in ex.get("tags") or []:
            self._upsert_embedded_tag(ex_id, tag)
        for swap in ex.get("swaps") or []:
            swap_id = _coerce_int(swap.get("id") if isinstance(swap, dict) else swap)
            if swap_id is not None:
                self.conn.execute(
                    "INSERT OR IGNORE INTO swap (exercise_id, swap_exercise_id) VALUES (?, ?)",
                    (ex_id, swap_id),
                )

    def _upsert_embedded_tag(self, ex_id, tag):
        if not isinstance(tag, dict) or tag.get("id") is None:
            return
        tag_id = _coerce_int(tag.get("id"))
        self.conn.execute(
            "INSERT INTO tag (id, title, type) VALUES (?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET title=excluded.title, type=excluded.type",
            (tag_id, tag.get("title") or "", _coerce_int(tag.get("type"))),
        )
        self.conn.execute(
            "INSERT OR IGNORE INTO exercise_tag (exercise_id, tag_id) VALUES (?, ?)",
            (ex_id, tag_id),
        )

    def _sync_tag_catalog(self):
        """Pull the full tag catalog (best effort; embedded tags already cover usage)."""
        for tag_type, path in TAG_PATHS.items():
            try:
                tags = _as_tag_list(self._api_get(path))
            except RuntimeError as e:
                _eprint(f"warning: tag sync {path} skipped ({e})")
                continue
            for tag in tags:
                if isinstance(tag, dict) and tag.get("id") is not None:
                    self.conn.execute(
                        "INSERT INTO tag (id, title, type) VALUES (?, ?, ?) "
                        "ON CONFLICT(id) DO UPDATE SET title=excluded.title, type=excluded.type",
                        (_coerce_int(tag["id"]), tag.get("title") or "", _coerce_int(tag.get("type", tag_type))),
                    )

    def _delete_exercise_rows(self, ex_id):
        self.conn.execute("DELETE FROM exercise WHERE id=?", (ex_id,))
        self.conn.execute("DELETE FROM exercise_tag WHERE exercise_id=?", (ex_id,))
        self.conn.execute("DELETE FROM swap WHERE exercise_id=?", (ex_id,))
        self.conn.execute("DELETE FROM exercise_fts WHERE ex_id=?", (ex_id,))

    # -- write-through hooks (call after API create/update/delete) -----------

    def record_upsert(self, ex):
        """Write-through after a create/update so the cache stays correct."""
        generation = int(self._meta("sync_generation", "0"))
        self._upsert_exercise(ex, generation)
        self.conn.commit()

    def record_delete(self, ex_id):
        self._delete_exercise_rows(_coerce_int(ex_id))
        self.conn.commit()

    # -- reads ---------------------------------------------------------------

    def get(self, ex_id):
        self.ensure_fresh()
        row = self.conn.execute("SELECT * FROM exercise WHERE id=?", (_coerce_int(ex_id),)).fetchone()
        return dict(row) if row else None

    def search(self, query, limit=20):
        self.ensure_fresh()
        match = " ".join(f'"{t}"*' for t in query.split() if t)
        if not match:
            return []
        rows = self.conn.execute(
            "SELECT e.id, e.title, e.param_1_type, e.param_2_type, e.is_circuit, e.can_edit "
            "FROM exercise_fts f JOIN exercise e ON e.id = f.ex_id "
            "WHERE f.title MATCH ? ORDER BY rank LIMIT ?",
            (match, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def resolve(self, name):
        """Best-effort name -> exercise. Returns (exercise|None, candidates)."""
        self.ensure_fresh()
        hit = self._exact(name)
        if hit:
            return hit, [hit]

        candidates = self.search(name)
        if not candidates:
            # A miss may mean an out-of-band addition; refresh once and retry.
            self.refresh()
            hit = self._exact(name)
            if hit:
                return hit, [hit]
            candidates = self.search(name)

        if len(candidates) == 1:
            return candidates[0], candidates
        return None, candidates

    def _exact(self, name):
        row = self.conn.execute(
            "SELECT id, title, param_1_type, param_2_type, is_circuit, can_edit "
            "FROM exercise WHERE lower(title)=lower(?) ORDER BY can_edit LIMIT 1",
            (name.strip(),),
        ).fetchone()
        return dict(row) if row else None

    def stats(self):
        def n(sql):
            return self.conn.execute(sql).fetchone()["n"]
        return {
            "db_path": str(self.db_path),
            "reference": {
                "exercises": self.count(),
                "custom": n("SELECT COUNT(*) AS n FROM exercise WHERE can_edit=1"),
                "tags": n("SELECT COUNT(*) AS n FROM tag"),
                "swaps": n("SELECT COUNT(*) AS n FROM swap"),
            },
            "programming": {
                "programs": n("SELECT COUNT(*) AS n FROM program"),
                "program_sessions": n("SELECT COUNT(*) AS n FROM program_session"),
                "blocks": n("SELECT COUNT(*) AS n FROM block"),
                "prescribed_sets": n("SELECT COUNT(*) AS n FROM prescribed_set"),
            },
            "cursors": self.cursors(),
        }


def main():
    args = sys.argv[1:]
    if not args:
        _eprint(__doc__.strip().splitlines()[0])
        _eprint("commands: sync [--force] | resolve <name> | search <query> | get <id> | stats")
        sys.exit(1)

    cmd, rest = args[0], args[1:]
    cache = ExerciseCache()

    if cmd == "sync":
        result = cache.refresh() if "--force" in rest else (cache.ensure_fresh() or cache.stats())
        print(json.dumps(result if result else cache.stats(), indent=2))
    elif cmd == "stats":
        print(json.dumps(cache.stats(), indent=2))
    elif cmd == "cursors":
        print(json.dumps(cache.cursors(), indent=2))
    elif cmd == "get":
        if not rest:
            _eprint("get requires an exercise id")
            sys.exit(1)
        ex = cache.get(rest[0])
        if not ex:
            _eprint(f"No exercise with id {rest[0]}")
            sys.exit(1)
        print(json.dumps(ex, indent=2))
    elif cmd == "search":
        if not rest:
            _eprint("search requires a query")
            sys.exit(1)
        print(json.dumps(cache.search(" ".join(rest)), indent=2))
    elif cmd == "resolve":
        if not rest:
            _eprint("resolve requires a name")
            sys.exit(1)
        match, candidates = cache.resolve(" ".join(rest))
        print(json.dumps({"match": match, "candidates": candidates}, indent=2))
        sys.exit(0 if match else 3)
    elif cmd == "create":
        if not rest:
            _eprint("create requires an exercise JSON body (or - for stdin)")
            sys.exit(1)
        raw = sys.stdin.read() if rest[0] == "-" else rest[0]
        status, resp = th_client.request("POST", "/2.0/coach/exercise/create", json.loads(raw))
        if not (200 <= status < 300):
            _eprint(f"create failed (HTTP {status}): {resp}")
            sys.exit(1)
        ex = _unwrap(resp)
        cache.record_upsert(ex)  # write-through: mirror stays correct without a re-sync
        print(json.dumps(ex, indent=2))
    elif cmd == "forget":
        if not rest:
            _eprint("forget requires an exercise id")
            sys.exit(1)
        cache.record_delete(rest[0])  # cache-only; run after deleting via the API
        print(f"Removed exercise {rest[0]} from the local mirror.")
    else:
        _eprint(f"Unknown command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
