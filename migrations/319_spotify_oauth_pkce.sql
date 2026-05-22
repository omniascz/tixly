-- 319_spotify_oauth_pkce.sql
-- Spotify Authorization Code Flow + PKCE (RFC 7636) state storage.
--
-- Pending OAuth (před callback): user clicked "Connect Spotify" → server
-- vygeneroval verifier + state, redirected na Spotify. Po callback potřebujem
-- najít verifier podle state. TTL 10 min — Spotify auth flow typicky pod 5min.
--
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS marketing.spotify_oauth_pending (
  state          text PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  code_verifier  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT now() + INTERVAL '10 minutes'
);

CREATE INDEX IF NOT EXISTS idx_spotify_oauth_pending_user
  ON marketing.spotify_oauth_pending(user_id);
CREATE INDEX IF NOT EXISTS idx_spotify_oauth_pending_expires
  ON marketing.spotify_oauth_pending(expires_at);

-- TTL cleanup — cron `/api/internal/cron/cleanup-oauth-pending` může mazat
-- expired rows. Jednoduchá SQL function pro idempotent cleanup.
CREATE OR REPLACE FUNCTION marketing.cleanup_expired_spotify_oauth() RETURNS integer AS $$
DECLARE deleted_count integer;
BEGIN
  DELETE FROM marketing.spotify_oauth_pending WHERE expires_at < NOW()
  RETURNING 1 INTO deleted_count;
  RETURN COALESCE(deleted_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE marketing.spotify_oauth_pending IS
  'PKCE state storage: verifier + state mapped to user_id, expires 10 min.';

COMMIT;
