-- Coach roster main-lift PRs: one row per (coach org, roster athlete, lift family) holding the
-- athlete's best PR for that family, resolved from the variant they actually log. Populated by the
-- coach PR sync (CoachAthletePrStore). Org-scoped, like the rest of the coach warehouse. The local
-- node:sqlite adapter applies this same file via applyMigrations.
CREATE TABLE IF NOT EXISTS coach_athlete_pr (
  org_id         INTEGER NOT NULL,
  athlete_id     INTEGER NOT NULL,
  athlete_name   TEXT,
  family         TEXT NOT NULL,
  label          TEXT,
  exercise_id    INTEGER,
  exercise_title TEXT,
  weight         REAL,
  reps           INTEGER,
  date           TEXT,
  units          TEXT,
  synced_at      INTEGER,
  source         TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY (org_id, athlete_id, family)
);
