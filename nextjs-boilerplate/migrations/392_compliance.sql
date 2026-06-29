-- Migration 392: Compliance infrastructure
-- DSA, eIDAS e-signatures, AML/KYC extensions, Consumer Rights, WCAG skip audit

-- ─── DSA (Digital Services Act) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance.dsa_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reporter_user_id  UUID REFERENCES identity.users(id) ON DELETE SET NULL,
  reporter_email    TEXT,          -- for anonymous / guest reports
  target_type       TEXT NOT NULL, -- 'event' | 'promoter' | 'ticket_type' | 'listing'
  target_id         UUID,
  category          TEXT NOT NULL, -- see DSA Art. 16 categories
  description       TEXT NOT NULL,
  evidence_url      TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',  -- pending | reviewing | resolved | dismissed
  resolved_at       TIMESTAMPTZ,
  resolution_note   TEXT,
  reviewer_user_id  UUID REFERENCES identity.users(id) ON DELETE SET NULL,
  ip_hash           TEXT           -- SHA-256 of reporter IP for abuse prevention
);

CREATE INDEX IF NOT EXISTS dsa_reports_status_idx ON compliance.dsa_reports (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS dsa_reports_target_idx ON compliance.dsa_reports (target_type, target_id);

ALTER TABLE compliance.dsa_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY dsa_reports_admin ON compliance.dsa_reports
  FOR ALL
  USING (current_setting('app.is_platform_admin', true) = 'true');
CREATE POLICY dsa_reports_own ON compliance.dsa_reports
  FOR SELECT
  USING (reporter_user_id::text = current_setting('app.current_user_id', true));

-- ─── eIDAS — Electronic Signatures ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance.e_signatures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id         UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  promoter_id     UUID REFERENCES platform.promoters(id) ON DELETE CASCADE,
  document_type   TEXT NOT NULL,  -- 'terms_of_service' | 'promoter_contract' | 'dpa' | 'privacy_policy'
  document_version TEXT NOT NULL, -- e.g. '2026-06'
  document_hash   TEXT NOT NULL,  -- SHA-256 of document text at time of signing
  ip_address      TEXT,           -- masked: last octet zeroed for GDPR
  user_agent      TEXT,
  signature_method TEXT NOT NULL DEFAULT 'click_to_agree',  -- simple|advanced eIDAS
  locale          TEXT            -- language the document was shown in
);

CREATE INDEX IF NOT EXISTS e_signatures_user_idx     ON compliance.e_signatures (user_id);
CREATE INDEX IF NOT EXISTS e_signatures_promoter_idx ON compliance.e_signatures (promoter_id);
ALTER TABLE compliance.e_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY e_signatures_own ON compliance.e_signatures
  FOR SELECT
  USING (user_id::text = current_setting('app.current_user_id', true));

-- ─── AML / KYC extensions ────────────────────────────────────────────────────

ALTER TABLE platform.promoters ADD COLUMN IF NOT EXISTS aml_status TEXT DEFAULT 'pending';
ALTER TABLE platform.promoters ADD COLUMN IF NOT EXISTS sanctions_checked_at TIMESTAMPTZ;
ALTER TABLE platform.promoters ADD COLUMN IF NOT EXISTS sanctions_match JSONB;
ALTER TABLE platform.promoters ADD COLUMN IF NOT EXISTS is_pep BOOLEAN DEFAULT FALSE;
ALTER TABLE platform.promoters ADD COLUMN IF NOT EXISTS eu_company_id TEXT;
ALTER TABLE platform.promoters ADD COLUMN IF NOT EXISTS eu_country TEXT;

-- AML checks audit log
CREATE TABLE IF NOT EXISTS compliance.aml_checks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  promoter_id      UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  check_type       TEXT NOT NULL,  -- 'sanctions' | 'pep' | 'eu_registry' | 'full_aml'
  result           TEXT NOT NULL,  -- 'clear' | 'match' | 'error' | 'manual_review'
  provider         TEXT,           -- 'opensanctions' | 'eu_consolidated' | 'ares' | 'vies'
  score            NUMERIC(5,2),   -- match confidence 0-100
  raw_response     JSONB,
  reviewer_note    TEXT
);

CREATE INDEX IF NOT EXISTS aml_checks_promoter_idx ON compliance.aml_checks (promoter_id, checked_at DESC);
ALTER TABLE compliance.aml_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY aml_checks_admin ON compliance.aml_checks
  FOR ALL
  USING (current_setting('app.is_platform_admin', true) = 'true');

-- ─── Consumer Rights — checkout withdrawal notice ────────────────────────────

ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS withdrawal_rights_shown BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── Onboarding — T&C acceptance (step 8) ────────────────────────────────────

ALTER TABLE platform.promoter_onboarding
  ADD COLUMN IF NOT EXISTS terms_accepted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version       TEXT,
  ADD COLUMN IF NOT EXISTS terms_ip            TEXT;
