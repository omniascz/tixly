-- 087_onfido_verifications.sql
-- Onfido identity verification (alternative to BankID for international users).

CREATE TABLE IF NOT EXISTS identity.onfido_verifications (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL,
  applicant_id         TEXT NOT NULL UNIQUE,
  workflow_run_id      TEXT UNIQUE,
  status               TEXT NOT NULL DEFAULT 'pending',
  result               TEXT,
  identity_hash        TEXT,
  raw_webhook_payload  JSONB,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  completed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_onfido_user          ON identity.onfido_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_onfido_identity_hash ON identity.onfido_verifications(identity_hash);
