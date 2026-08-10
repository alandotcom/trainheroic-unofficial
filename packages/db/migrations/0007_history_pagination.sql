-- Cover the stable newest-first keyset order used by bounded warehouse history pages.

DROP INDEX IF EXISTS idx_aworkout_date;
CREATE INDEX idx_aworkout_date ON athlete_workout (user_id, date, id);

DROP INDEX IF EXISTS idx_psession_program;
CREATE INDEX idx_psession_program ON program_session (org_id, program_id, date, id);

CREATE INDEX IF NOT EXISTS idx_mstream_viewed
  ON message_stream (org_id, last_viewed, id);

DROP INDEX IF EXISTS idx_mcomment_stream;
CREATE INDEX idx_mcomment_stream ON message_comment (org_id, stream_id, ts, id);
