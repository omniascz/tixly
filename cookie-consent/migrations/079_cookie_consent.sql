CREATE SCHEMA IF NOT EXISTS consent;

CREATE TABLE consent.banner_configs (
  promoter_id UUID PRIMARY KEY,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE consent.records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL,
  visitor_id TEXT NOT NULL,
  consents JSONB NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  banner_version TEXT NOT NULL,
  consented_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_consent_visitor ON consent.records(visitor_id, promoter_id);
CREATE INDEX idx_consent_expires ON consent.records(expires_at);
