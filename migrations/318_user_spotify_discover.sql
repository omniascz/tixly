-- 318_user_spotify_discover.sql
-- DACH parity #P2-3: Spotify discovery (DICE pattern, 40 %+ prodejů přes
-- discovery). Buyer připojí Spotify, my fetchneme jeho top artists +
-- genres a doporučujeme eventy match-ující jeho music profile.
--
-- Mock režim (žádný SPOTIFY_CLIENT_ID env): connect endpoint zapíše fake
-- top artists, discover endpoint na nich JOIN-uje s lineups.event_artists.
--
-- Idempotent.

BEGIN;

-- Per-user Spotify connection + tokens (encrypted při production
-- integration — zatím pro mock plain bytea OK).
CREATE TABLE IF NOT EXISTS marketing.user_spotify_connections (
  user_id            uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  spotify_user_id    text,                  -- Spotify's user ID, NULL pro mock
  spotify_display_name text,
  access_token_enc   bytea,                  -- encrypted v produkci
  refresh_token_enc  bytea,
  token_iv           bytea,
  scopes             text[] NOT NULL DEFAULT '{}',
  expires_at         timestamptz,            -- access_token expiry
  connected_at       timestamptz NOT NULL DEFAULT now(),
  last_sync_at       timestamptz,
  is_mock            boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_spotify_connections_sync
  ON marketing.user_spotify_connections(last_sync_at)
  WHERE last_sync_at IS NOT NULL;

-- User top artists snapshot — synced periodicky z Spotify "Top Artists"
-- endpoint. Pro mock režim seedneme fake data v connect endpointu.
CREATE TABLE IF NOT EXISTS marketing.user_top_artists (
  user_id            uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  artist_spotify_id  text,                   -- NULL pro fake/mock
  artist_name        text NOT NULL,
  rank               integer NOT NULL,        -- 1 = oblíbenější
  genres             text[] NOT NULL DEFAULT '{}',
  synced_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, rank)
);

CREATE INDEX IF NOT EXISTS idx_user_top_artists_name
  ON marketing.user_top_artists(LOWER(artist_name));

ALTER TABLE marketing.user_spotify_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.user_top_artists ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'p_spotify_conn_own'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY p_spotify_conn_own ON marketing.user_spotify_connections
        FOR ALL
        USING (app_is_platform_admin() OR user_id::text = current_setting('app.current_user_id', true))
    $POL$;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'p_user_top_artists_own'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY p_user_top_artists_own ON marketing.user_top_artists
        FOR ALL
        USING (app_is_platform_admin() OR user_id::text = current_setting('app.current_user_id', true))
    $POL$;
  END IF;
END $$;

COMMENT ON TABLE marketing.user_spotify_connections IS
  'Buyer Spotify OAuth connection. is_mock=true pokud chybí SPOTIFY_CLIENT_ID env.';
COMMENT ON TABLE marketing.user_top_artists IS
  'Top N artists snapshot z user Spotify profilu. Source pro discovery feed.';

COMMIT;
