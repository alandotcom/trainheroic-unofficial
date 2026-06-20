-- Programming + messaging zones (accumulate-only; never auto-pruned). Tenant-scoped.

-- Programming zone: what the coach prescribed, over time.
CREATE TABLE IF NOT EXISTS program (
  org_id       INTEGER NOT NULL,
  id           INTEGER NOT NULL,
  title        TEXT,
  raw          TEXT,
  source       TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY (org_id, id)
);

CREATE TABLE IF NOT EXISTS program_session (
  org_id     INTEGER NOT NULL,
  id         INTEGER NOT NULL,
  program_id INTEGER,
  day_index  INTEGER,
  date       TEXT,
  title      TEXT,
  published  INTEGER NOT NULL DEFAULT 0,
  raw        TEXT,
  source     TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY (org_id, id)
);
CREATE INDEX IF NOT EXISTS idx_psession_program ON program_session (org_id, program_id);

CREATE TABLE IF NOT EXISTS block (
  org_id             INTEGER NOT NULL,
  id                 INTEGER NOT NULL,
  program_session_id INTEGER,
  ord                INTEGER,
  type               INTEGER,
  title              TEXT,
  instruction        TEXT,
  raw                TEXT,
  source             TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY (org_id, id)
);
CREATE INDEX IF NOT EXISTS idx_block_session ON block (org_id, program_session_id);

-- One row per prescribed set (param_N_data slots expanded). Implicit rowid PK;
-- rebuilt per session on each sync, so no natural id is needed.
CREATE TABLE IF NOT EXISTS prescribed_set (
  org_id        INTEGER NOT NULL,
  block_id      INTEGER NOT NULL,
  exercise_id   INTEGER,
  set_index     INTEGER,
  param_1_type  INTEGER,
  param_1_value REAL,
  param_2_type  INTEGER,
  param_2_value REAL,
  source        TEXT NOT NULL DEFAULT 'api'
);
CREATE INDEX IF NOT EXISTS idx_pset_block ON prescribed_set (org_id, block_id);

-- Messaging zone: conversations (streams) + their comments.
CREATE TABLE IF NOT EXISTS message_stream (
  org_id      INTEGER NOT NULL,
  id          INTEGER NOT NULL,
  kind        TEXT,
  title       TEXT,
  team_id     INTEGER,
  user_id     INTEGER,
  last_viewed INTEGER,
  raw         TEXT,
  source      TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY (org_id, id)
);

CREATE TABLE IF NOT EXISTS message_comment (
  org_id      INTEGER NOT NULL,
  id          INTEGER NOT NULL,
  stream_id   INTEGER,
  ts          INTEGER,
  content     TEXT,
  author_name TEXT,
  author_logo TEXT,
  image_url   TEXT,
  is_author   INTEGER NOT NULL DEFAULT 0,
  parent_id   INTEGER,
  reactions   TEXT,
  raw         TEXT,
  source      TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY (org_id, id)
);
CREATE INDEX IF NOT EXISTS idx_mcomment_stream ON message_comment (org_id, stream_id, ts);
