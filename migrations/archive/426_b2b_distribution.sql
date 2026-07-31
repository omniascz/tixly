CREATE TABLE IF NOT EXISTS platform.distribution_partners (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  client_id           text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  client_secret_hash  text NOT NULL,
  scopes              text[] NOT NULL DEFAULT '{events:read,inventory:read}',
  allowed_promoter_ids uuid[],
  active              boolean NOT NULL DEFAULT true,
  last_used_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.distribution_access_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid NOT NULL REFERENCES platform.distribution_partners(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dist_tokens_hash ON platform.distribution_access_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_dist_tokens_expires ON platform.distribution_access_tokens(expires_at);
