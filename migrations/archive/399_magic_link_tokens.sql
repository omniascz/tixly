-- Magic link tokens pro přihlášení bez hesla
-- Token je SHA-256 hash plaintextu zaslaného emailem; UNIQUE index umožňuje
-- O(1) lookup bez skenování tabulky.

CREATE TABLE IF NOT EXISTS identity.magic_link_tokens (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL,          -- SHA-256(plaintext), hex
  expires_at   timestamptz NOT NULL DEFAULT NOW() + INTERVAL '15 minutes',
  used_at      timestamptz,            -- NULL = nevyužitý
  requester_ip text,
  requester_ua text,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_magic_link_tokens_hash
  ON identity.magic_link_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_user
  ON identity.magic_link_tokens(user_id, created_at DESC);

-- RLS: kupec vidí jen své tokeny (pro případné API listing)
ALTER TABLE identity.magic_link_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY magic_link_tokens_owner ON identity.magic_link_tokens
  USING (user_id::text = current_setting('app.user_id', true));
