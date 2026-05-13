-- GDPR consent management extension
-- Adds per-user consent tracking with audit trail

CREATE TYPE consent_type AS ENUM ('marketing', 'analytics', 'personalization', 'functional');
CREATE TYPE consent_status AS ENUM ('granted', 'denied', 'withdrawn');
CREATE TYPE lawful_basis AS ENUM ('consent', 'legitimate_interest', 'contract', 'legal_obligation', 'vital_interests', 'public_task');

-- User consents with per-type status
CREATE TABLE consent.user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type consent_type NOT NULL,
  status consent_status NOT NULL DEFAULT 'denied',
  granted_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  lawful_basis lawful_basis NOT NULL DEFAULT 'consent',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, type)
);

CREATE INDEX idx_user_consents_user ON consent.user_consents(user_id);
CREATE INDEX idx_user_consents_status ON consent.user_consents(status);
CREATE INDEX idx_user_consents_type ON consent.user_consents(type);

-- Immutable audit trail
CREATE TABLE consent.audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  consent_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL CHECK(action IN ('granted', 'withdrawn', 'updated')),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  ip_address INET,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_trail_user ON consent.audit_trail(user_id);
CREATE INDEX idx_audit_trail_consent ON consent.audit_trail(consent_id);
CREATE INDEX idx_audit_trail_timestamp ON consent.audit_trail(timestamp);
CREATE INDEX idx_audit_trail_user_timestamp ON consent.audit_trail(user_id, timestamp DESC);

-- Retention policy: keep audit trail for 2 years
-- DELETE FROM consent.audit_trail WHERE timestamp < NOW() - INTERVAL '2 years';
