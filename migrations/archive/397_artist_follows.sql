-- Migration 397: Artist follows + onsale alerts

CREATE TABLE IF NOT EXISTS lineups.artist_follows (
  user_id    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  artist_id  UUID NOT NULL REFERENCES lineups.artists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, artist_id)
);

CREATE INDEX IF NOT EXISTS artist_follows_artist_idx ON lineups.artist_follows (artist_id);

ALTER TABLE lineups.artist_follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY artist_follows_own ON lineups.artist_follows
  FOR ALL
  USING (
    user_id = current_setting('app.current_user_id', true)::uuid
    OR current_setting('app.is_service', true) = 'true'
  );
