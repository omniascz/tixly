-- =============================================================================
-- Migration 151: Benefitní platby (Benefit Plus, Pluxee, Gallery Beta)
-- Feature #194: Czech employee benefit platforms as payment method
--              Benefit Plus, Pluxee (ex-Sodexo Cafeterie), Gallery Beta, Benefity
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS benefit_payments;

-- Supported benefit providers
CREATE TABLE IF NOT EXISTS benefit_payments.providers (
  id                  TEXT PRIMARY KEY,       -- 'benefit_plus', 'pluxee', 'gallery_beta', 'benefity'
  name                TEXT NOT NULL,
  api_base_url        TEXT NOT NULL,
  logo_url            TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  supported_categories TEXT[] NOT NULL DEFAULT '{culture,sport,recreation}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert known providers
INSERT INTO benefit_payments.providers (id, name, api_base_url) VALUES
  ('benefit_plus', 'Benefit Plus', 'https://api.benefit-plus.eu/v2'),
  ('pluxee', 'Pluxee (Sodexo Cafeterie)', 'https://api.pluxee.cz/v1'),
  ('gallery_beta', 'Gallery Beta', 'https://api.gallerybeta.cz/v1'),
  ('benefity', 'Benefity.cz', 'https://api.benefity.cz/v2')
ON CONFLICT (id) DO NOTHING;

-- Payment session: one per checkout attempt using benefit funds
CREATE TABLE IF NOT EXISTS benefit_payments.payment_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL,
  user_id             UUID NOT NULL,
  provider_id         TEXT NOT NULL REFERENCES benefit_payments.providers(id),
  amount_hellers      INT NOT NULL CHECK (amount_hellers > 0),
  currency            TEXT NOT NULL DEFAULT 'CZK',
  status              TEXT NOT NULL DEFAULT 'initiated'
                        CHECK (status IN ('initiated', 'pending_user_auth', 'authorized', 'captured', 'failed', 'refunded')),
  provider_session_id TEXT,                   -- external session/token from provider API
  provider_tx_id      TEXT,                   -- confirmed transaction ID from provider
  employee_id         TEXT,                   -- provider's employee identifier
  error_code          TEXT,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  captured_at         TIMESTAMPTZ
);

CREATE INDEX idx_benefit_sessions_order ON benefit_payments.payment_sessions(order_id);
CREATE INDEX idx_benefit_sessions_user ON benefit_payments.payment_sessions(user_id);
CREATE INDEX idx_benefit_sessions_provider ON benefit_payments.payment_sessions(provider_id);
