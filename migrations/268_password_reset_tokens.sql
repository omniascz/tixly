-- Password reset tokens — buyer + promotér self-service reset hesla.
--
-- Flow:
--   1. Kupec vyplní email v /cs/forgot-password
--   2. POST /api/auth/forgot-password
--      → vygeneruje token (32 bytes random hex)
--      → uloží HASH (bcrypt) tokenu do DB s TTL 1h
--      → pošle email s URL: /cs/reset-password?token=<plaintext>
--   3. Kupec klikne odkaz, vyplní nové heslo
--   4. POST /api/auth/reset-password
--      → ověří token (bcrypt compare proti hashům validních záznamů)
--      → ověří expires_at > NOW() a used_at IS NULL
--      → UPDATE user.password_hash + DELETE/marks used token
--      → fire revocation všech existujících refresh tokens (logout všude)

BEGIN;

CREATE TABLE IF NOT EXISTS identity.password_reset_tokens (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL,
  -- bcrypt hash plaintext tokenu (token sám není v DB)
  token_hash      TEXT         NOT NULL,
  -- IP adresa requesteru (audit log)
  requester_ip    TEXT,
  -- User agent (audit log)
  requester_ua    TEXT,
  expires_at      TIMESTAMPTZ  NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE identity.password_reset_tokens IS
  'Single-use password reset tokens. TTL 1h. Token plaintext jen v emailu, v DB jen bcrypt hash.';

CREATE INDEX IF NOT EXISTS idx_password_reset_user
  ON identity.password_reset_tokens (user_id, expires_at)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_password_reset_expires
  ON identity.password_reset_tokens (expires_at)
  WHERE used_at IS NULL;

-- Auto-cleanup je v cron job (TODO: process-expired-reset-tokens)

COMMIT;
