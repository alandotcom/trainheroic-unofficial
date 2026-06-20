-- TrainHeroic MCP — initial schema.
-- Every table is tenant-scoped by org_id (private deployment today, multi-tenant safe).

-- Lightweight account registry (enumerate/manage tenants independent of live tokens).
-- Credentials are NOT stored here; they live in the OAuth grant's encrypted props.
CREATE TABLE IF NOT EXISTS account (
  th_user_id INTEGER PRIMARY KEY,
  org_id     INTEGER,
  email      TEXT,
  role       TEXT,
  created_at INTEGER,
  last_seen  INTEGER
);

-- Per-tenant key/value (library TTL timestamp, sync generation counter).
CREATE TABLE IF NOT EXISTS sync_meta (
  org_id INTEGER NOT NULL,
  key    TEXT NOT NULL,
  value  TEXT,
  PRIMARY KEY (org_id, key)
);

-- Incremental watermarks. scope_id = athlete/program/stream id, or 0 for global.
-- generation is set only for prune-to-match zones (the exercise library).
CREATE TABLE IF NOT EXISTS sync_state (
  org_id     INTEGER NOT NULL,
  resource   TEXT NOT NULL,
  scope_id   INTEGER NOT NULL DEFAULT 0,
  cursor     TEXT,
  synced_at  INTEGER,
  generation INTEGER,
  PRIMARY KEY (org_id, resource, scope_id)
);

-- Reference zone: the exercise library mirror. Read-through with a 7-day TTL and
-- prune-to-match reconciliation (guarded by a floor). Tags/swaps are kept inside
-- the raw JSON; search uses search_text (lowercased title) since D1 has no FTS5.
CREATE TABLE IF NOT EXISTS exercise (
  org_id       INTEGER NOT NULL,
  id           INTEGER NOT NULL,
  title        TEXT NOT NULL,
  search_text  TEXT NOT NULL,
  param_1_type INTEGER,
  param_2_type INTEGER,
  can_edit     INTEGER NOT NULL DEFAULT 0,
  user_id      INTEGER,
  use_count    INTEGER NOT NULL DEFAULT 0,
  raw          TEXT NOT NULL,
  generation   INTEGER NOT NULL,
  source       TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY (org_id, id)
);
CREATE INDEX IF NOT EXISTS idx_exercise_search ON exercise (org_id, search_text);
CREATE INDEX IF NOT EXISTS idx_exercise_custom ON exercise (org_id, can_edit);
