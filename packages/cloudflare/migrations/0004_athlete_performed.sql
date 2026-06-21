-- Surface logged results in the athlete workouts warehouse, mirroring the live presenter:
-- a per-workout `logged` flag and per-exercise `performed` sets (what the athlete actually
-- logged, distinct from the `prescribed` program). ALTER TABLE ADD COLUMN is append-safe:
-- existing rows default to not-logged / NULL until their next sync rebuilds them.
ALTER TABLE athlete_workout ADD COLUMN logged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE athlete_workout_exercise ADD COLUMN performed TEXT;
