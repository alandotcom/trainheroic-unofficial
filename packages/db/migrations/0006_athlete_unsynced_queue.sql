-- The history drain filters on the null watermark, orders by exercise id, and takes a small batch.
-- Including id lets SQLite seek directly into the unsynced partition in queue order instead of
-- scanning the (user_id, id) primary key and filtering an ever-growing completed prefix.
DROP INDEX IF EXISTS idx_aexercise_unsynced;
CREATE INDEX idx_aexercise_unsynced
  ON athlete_exercise (user_id, sessions_synced_at, id);
