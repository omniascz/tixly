-- Migration: 001_refresh_tokens
-- Schema: identity
-- Description: Refresh token storage for JWT authentication with token rotation and theft detection

CREATE TABLE identity.refresh_tokens (
  jti         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  family      UUID NOT NULL,
  is_revoked  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Index for looking up all tokens for a user (e.g. logoutAll)
CREATE INDEX idx_refresh_tokens_user
  ON identity.refresh_tokens(user_id, is_revoked);

-- Index for revoking an entire token family on REFRESH_TOKEN_REUSE detection
CREATE INDEX idx_refresh_tokens_family
  ON identity.refresh_tokens(family);

-- Partial index for cleanup cron — only non-revoked expired tokens need to be checked
CREATE INDEX idx_refresh_tokens_expires
  ON identity.refresh_tokens(expires_at)
  WHERE is_revoked = FALSE;

-- Comments
COMMENT ON TABLE identity.refresh_tokens IS
  'Stores refresh token records for JWT rotation. On token reuse, the entire family is revoked to mitigate token theft.';

COMMENT ON COLUMN identity.refresh_tokens.jti IS
  'JWT ID — matches the jti claim in the signed refresh token. Primary key.';

COMMENT ON COLUMN identity.refresh_tokens.family IS
  'Token family UUID. All refresh tokens in a rotation chain share the same family. On reuse detection, the whole family is revoked.';

COMMENT ON COLUMN identity.refresh_tokens.is_revoked IS
  'TRUE if this token has been used (rotated), explicitly revoked (logout), or part of a compromised family.';
