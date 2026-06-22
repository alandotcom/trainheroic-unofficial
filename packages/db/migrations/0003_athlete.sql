-- Athlete training warehouse (accumulate-only; never auto-pruned). Scoped by the athlete's
-- own user_id, since athletes have no org. Mirrors the coach warehouse style in 0002.

-- Incremental watermarks for the athlete zones (parallel to sync_state, keyed by user_id).
-- scope_id = exercise/program-workout id, or 0 for global.
CREATE TABLE IF NOT EXISTS athlete_sync_state (
  user_id   INTEGER NOT NULL,
  resource  TEXT NOT NULL,
  scope_id  INTEGER NOT NULL DEFAULT 0,
  cursor    TEXT,
  synced_at INTEGER,
  PRIMARY KEY (user_id, resource, scope_id)
);

-- Workouts zone: scheduled + completed workouts over time.
CREATE TABLE IF NOT EXISTS athlete_workout (
  user_id       INTEGER NOT NULL,
  id            INTEGER NOT NULL,
  date          TEXT,
  title         TEXT,
  program_id    INTEGER,
  program_title TEXT,
  team_id       INTEGER,
  team_title    TEXT,
  raw           TEXT,
  source        TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_aworkout_date ON athlete_workout (user_id, date);

-- One row per exercise instance within a workout (flattened from the blocks). Rebuilt per
-- workout on each sync (implicit rowid PK), so no natural id is needed.
CREATE TABLE IF NOT EXISTS athlete_workout_exercise (
  user_id     INTEGER NOT NULL,
  workout_id  INTEGER NOT NULL,
  block_order INTEGER,
  block_title TEXT,
  is_test     INTEGER NOT NULL DEFAULT 0,
  exercise_id INTEGER,
  title       TEXT,
  units       TEXT,
  prescribed  TEXT,
  instruction TEXT,
  source      TEXT NOT NULL DEFAULT 'api'
);
CREATE INDEX IF NOT EXISTS idx_aworkout_ex_workout ON athlete_workout_exercise (user_id, workout_id);
CREATE INDEX IF NOT EXISTS idx_aworkout_ex_exercise ON athlete_workout_exercise (user_id, exercise_id);

-- Exercise catalog: the exercises the athlete has logged. sessions_synced_at marks whether the
-- per-exercise session history has been pulled (drained in batches to respect subrequest caps).
CREATE TABLE IF NOT EXISTS athlete_exercise (
  user_id            INTEGER NOT NULL,
  id                 INTEGER NOT NULL,
  title              TEXT NOT NULL,
  search_text        TEXT NOT NULL,
  param_1_type       INTEGER,
  param_2_type       INTEGER,
  is_circuit         INTEGER NOT NULL DEFAULT 0,
  raw                TEXT,
  sessions_synced_at INTEGER,
  source             TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_aexercise_search ON athlete_exercise (user_id, search_text);
CREATE INDEX IF NOT EXISTS idx_aexercise_unsynced ON athlete_exercise (user_id, sessions_synced_at);

-- Per-exercise, per-session performance (the time-series for research over time).
CREATE TABLE IF NOT EXISTS athlete_exercise_session (
  user_id                       INTEGER NOT NULL,
  saved_workout_set_exercise_id INTEGER NOT NULL,
  exercise_id                   INTEGER NOT NULL,
  date                          TEXT,
  abr                           TEXT,
  best_estimated_1rm            REAL,
  program_workout_id            INTEGER,
  team_id                       INTEGER,
  raw                           TEXT,
  source                        TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY (user_id, saved_workout_set_exercise_id)
);
CREATE INDEX IF NOT EXISTS idx_asession_exercise ON athlete_exercise_session (user_id, exercise_id, date);

-- Personal records per exercise (rebuilt per exercise on sync; implicit rowid PK).
CREATE TABLE IF NOT EXISTS athlete_pr (
  user_id                       INTEGER NOT NULL,
  exercise_id                   INTEGER NOT NULL,
  description                   TEXT,
  reps                          INTEGER,
  weight                        REAL,
  units                         TEXT,
  date                          TEXT,
  saved_workout_set_exercise_id INTEGER,
  source                        TEXT NOT NULL DEFAULT 'api'
);
CREATE INDEX IF NOT EXISTS idx_apr_exercise ON athlete_pr (user_id, exercise_id);

-- Working maxes per exercise.
CREATE TABLE IF NOT EXISTS athlete_working_max (
  user_id        INTEGER NOT NULL,
  exercise_id    INTEGER NOT NULL,
  title          TEXT,
  param_type     INTEGER,
  value          REAL,
  type_suffix    TEXT,
  working_max_id INTEGER,
  raw            TEXT,
  source         TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY (user_id, exercise_id)
);
