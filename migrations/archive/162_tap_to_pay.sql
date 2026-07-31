-- =============================================================================
-- Migration 162: Tap to Pay
-- Feature #163: Contactless card payment using phone NFC — no reader hardware
-- Stripe Tap to Pay SDK; extends POS (#30)
-- =============================================================================

CREATE TABLE IF NOT EXISTS pos.tap_to_pay_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  promoter_id         UUID NOT NULL,
  staff_user_id       UUID NOT NULL,
  device_id           TEXT NOT NULL,           -- mobile device identifier
  platform            TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  stripe_reader_id    TEXT,                    -- Stripe SDK reader token
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pos.tap_to_pay_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL REFERENCES pos.tap_to_pay_sessions(id),
  payment_intent_id   TEXT,                    -- Stripe PaymentIntent ID
  amount_hellers      INT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'CZK',
  status              TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
  ticket_type_id      UUID,
  quantity            INT NOT NULL DEFAULT 1,
  error_code          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX idx_tap_sessions_event ON pos.tap_to_pay_sessions(event_id);
CREATE INDEX idx_tap_transactions_session ON pos.tap_to_pay_transactions(session_id);
