-- =============================================================================
-- Migration 165: PayPal Integration
-- Feature #181: PayPal as payment method for foreign buyers
-- =============================================================================

CREATE TABLE IF NOT EXISTS payments.paypal_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL,           -- internal order
  user_id             UUID NOT NULL,
  paypal_order_id     TEXT NOT NULL UNIQUE,    -- PayPal order ID
  amount_hellers      BIGINT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'CZK',
  status              TEXT NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created', 'approved', 'captured', 'failed', 'refunded', 'cancelled')),
  paypal_capture_id   TEXT,                    -- after capture
  payer_email         TEXT,
  payer_name          TEXT,
  error_code          TEXT,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  captured_at         TIMESTAMPTZ
);

CREATE SCHEMA IF NOT EXISTS payments;

CREATE INDEX idx_paypal_orders_order ON payments.paypal_orders(order_id);
