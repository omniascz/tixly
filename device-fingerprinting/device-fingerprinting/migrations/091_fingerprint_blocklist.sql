-- Migration 091: Fingerprint blocklist for bot detection
-- Extends risk schema with a table for explicitly blocked device fingerprints

CREATE TABLE IF NOT EXISTS risk.fingerprint_blocklist (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_hash VARCHAR(64) NOT NULL UNIQUE,
  reason           VARCHAR(500) NOT NULL,
  blocked_by       UUID NOT NULL,
  blocked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ  -- NULL = permanent
);

CREATE INDEX ON risk.fingerprint_blocklist (fingerprint_hash) WHERE expires_at IS NULL OR expires_at > NOW();
CREATE INDEX ON risk.fingerprint_blocklist (expires_at) WHERE expires_at IS NOT NULL;
