-- Migration 395: Social login (Google + Apple OAuth)

-- Make password_hash nullable — OAuth users don't have one
ALTER TABLE identity.users ALTER COLUMN password_hash DROP NOT NULL;

-- OAuth account links (one user can have multiple providers)
CREATE TABLE IF NOT EXISTS identity.oauth_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id          UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,           -- 'google' | 'apple'
  provider_user_id TEXT NOT NULL,           -- Google sub or Apple sub (stable ID)
  provider_email   TEXT,
  provider_name    TEXT,
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS oauth_accounts_user_idx ON identity.oauth_accounts (user_id);

ALTER TABLE identity.oauth_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY oauth_accounts_own ON identity.oauth_accounts
  FOR SELECT
  USING (
    user_id = current_setting('app.current_user_id', true)::uuid
    OR current_setting('app.is_platform_admin', true) = 'true'
    OR current_setting('app.is_service', true) = 'true'
  );
