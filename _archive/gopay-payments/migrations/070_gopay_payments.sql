-- =============================================================================
-- 070_gopay_payments.sql
-- GoPay payments — perzistence plateb a jejich stavů.
-- Amounts jsou INTEGER haléře (GoPay `amount` je v haléřích).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS payments;

CREATE TABLE payments.gopay_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL,
  external_payment_id TEXT UNIQUE,
  amount_halire INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CZK',
  status TEXT NOT NULL,
  payment_instrument TEXT,
  gateway_url TEXT,
  buyer_email TEXT,
  buyer_first_name TEXT,
  buyer_last_name TEXT,
  raw_create_payload JSONB,
  raw_last_status JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gopay_order ON payments.gopay_payments(order_id);
