-- 274_b2b_api_keys.sql
-- B2B API key registry pro `/api/v1/*` endpointy.
-- Tokeny v formátu `tick_test_*` / `tick_live_*`.

BEGIN;

CREATE SCHEMA IF NOT EXISTS b2b;

CREATE TABLE IF NOT EXISTS b2b.api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id  uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  name         text NOT NULL,
  token_hash   text NOT NULL UNIQUE,    -- SHA-256 hash tokenu
  token_prefix text NOT NULL,           -- první 16 znaků pro UI list
  environment  text NOT NULL CHECK (environment IN ('test', 'live')),
  scope        text[] NOT NULL DEFAULT '{events:read}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid REFERENCES identity.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_b2b_api_keys_promoter ON b2b.api_keys(promoter_id);
CREATE INDEX IF NOT EXISTS idx_b2b_api_keys_active ON b2b.api_keys(token_hash) WHERE revoked_at IS NULL;

COMMENT ON TABLE b2b.api_keys IS
  'B2B API klíče pro /api/v1/* endpointy. Token NEVER ukládáme — jen SHA-256 hash.';

COMMIT;
