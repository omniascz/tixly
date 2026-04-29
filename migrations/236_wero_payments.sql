-- =============================================================================
-- Migration 236: Wero SEPA Instant A2A Payments
--
-- Adds Wero payment processor tables for European A2A payments with lower fees.
-- =============================================================================

-- ============================================================================
-- Main payment table
-- ============================================================================
CREATE TABLE IF NOT EXISTS payments.wero_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL,
  promoter_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'initiated',
    -- 'initiated' | 'authorized' | 'confirmed' | 'failed'
  external_id TEXT UNIQUE,  -- Wero's payment ID
  amount_halire INTEGER NOT NULL,  -- INTEGER haléře (1 Kč = 100 haléřů)
  iban_hash TEXT,  -- AES-256 encrypted for GDPR compliance

  -- Timestamps for state transitions
  initiated_at TIMESTAMPTZ DEFAULT NOW(),
  authorized_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,

  -- Error tracking
  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Indexes for common queries
  CONSTRAINT wero_payments_amount_positive CHECK (amount_halire > 0)
);

CREATE INDEX idx_wero_payments_order_id ON payments.wero_payments(order_id);
CREATE INDEX idx_wero_payments_external_id ON payments.wero_payments(external_id);
CREATE INDEX idx_wero_payments_promoter_id ON payments.wero_payments(promoter_id);
CREATE INDEX idx_wero_payments_status ON payments.wero_payments(status);
CREATE INDEX idx_wero_payments_created_at ON payments.wero_payments(created_at);

-- ============================================================================
-- Webhook audit table
-- ============================================================================
CREATE TABLE IF NOT EXISTS payments.wero_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES payments.wero_payments(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,  -- e.g., 'status_update'
  status TEXT,  -- Webhook status if applicable
  raw_payload JSONB,  -- Full webhook payload for debugging
  signature_valid BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wero_webhooks_payment_id ON payments.wero_webhooks(payment_id);
CREATE INDEX idx_wero_webhooks_processed_at ON payments.wero_webhooks(processed_at);

-- ============================================================================
-- Permissions (for RLS if multi-tenant)
-- ============================================================================
ALTER TABLE payments.wero_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.wero_webhooks ENABLE ROW LEVEL SECURITY;

-- Allow promoters to see their own payments
CREATE POLICY wero_payments_tenant_isolation ON payments.wero_payments
  FOR SELECT
  USING (
    promoter_id = current_setting('app.promoter_id', true) OR
    current_setting('app.is_admin', true)::boolean
  );

CREATE POLICY wero_webhooks_tenant_isolation ON payments.wero_webhooks
  FOR SELECT
  USING (
    payment_id IN (
      SELECT id FROM payments.wero_payments
      WHERE promoter_id = current_setting('app.promoter_id', true) OR
            current_setting('app.is_admin', true)::boolean
    )
  );
