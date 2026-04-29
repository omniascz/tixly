-- =============================================================================
-- 074_permanentky.sql
-- Permanentky (credit ledger) — templates, client_packages, usages
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS permanentky;

CREATE TABLE permanentky.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  total_credits INTEGER NOT NULL CHECK (total_credits > 0),
  validity_days INTEGER NOT NULL CHECK (validity_days > 0),
  price_halire INTEGER NOT NULL CHECK (price_halire >= 0),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_templates_promoter ON permanentky.templates(promoter_id);

CREATE TABLE permanentky.client_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  template_id UUID NOT NULL REFERENCES permanentky.templates(id),
  promoter_id UUID NOT NULL,
  total_credits INTEGER NOT NULL,
  remaining_credits INTEGER NOT NULL CHECK (remaining_credits >= 0),
  status TEXT NOT NULL DEFAULT 'pending_payment',
  price_paid_halire INTEGER NOT NULL,
  payment_ref TEXT,
  purchased_at TIMESTAMPTZ DEFAULT NOW(),
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (valid_until > valid_from)
);
CREATE INDEX idx_client_packages_client ON permanentky.client_packages(client_id);
CREATE INDEX idx_client_packages_status ON permanentky.client_packages(client_id, status, valid_until);

CREATE TABLE permanentky.usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES permanentky.client_packages(id),
  client_id UUID NOT NULL,
  reservation_id UUID,
  consumed_at TIMESTAMPTZ DEFAULT NOW(),
  is_refund BOOLEAN NOT NULL DEFAULT FALSE,
  refund_reason TEXT,
  refund_actor_id UUID
);
CREATE UNIQUE INDEX idx_usages_reservation_active
  ON permanentky.usages(reservation_id)
  WHERE reservation_id IS NOT NULL AND is_refund = FALSE;
CREATE INDEX idx_usages_package ON permanentky.usages(package_id);
