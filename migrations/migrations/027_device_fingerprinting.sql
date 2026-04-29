-- Migration 027: Device fingerprinting + velocity checks
-- Schema: risk (already exists from migration 023)

CREATE TABLE IF NOT EXISTS risk.device_fingerprints (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_hash VARCHAR(64) NOT NULL,
  user_id          UUID,
  ip_hash          VARCHAR(64) NOT NULL,
  user_agent_hash  VARCHAR(64),
  event_id         UUID,
  order_id         UUID,
  action           VARCHAR(50) NOT NULL DEFAULT 'checkout',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON risk.device_fingerprints (fingerprint_hash, created_at);
CREATE INDEX ON risk.device_fingerprints (ip_hash, created_at);
CREATE INDEX ON risk.device_fingerprints (user_id, created_at);

-- Velocity limits config
CREATE TABLE IF NOT EXISTS risk.velocity_limits (
  id             SERIAL PRIMARY KEY,
  dimension      VARCHAR(30) NOT NULL,  -- 'fingerprint' | 'ip' | 'user'
  window_seconds INT NOT NULL,
  max_count      INT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(dimension)
);

INSERT INTO risk.velocity_limits (dimension, window_seconds, max_count) VALUES
  ('fingerprint', 86400, 5),
  ('ip',          86400, 10),
  ('user',        3600,  3)
ON CONFLICT (dimension) DO NOTHING;
