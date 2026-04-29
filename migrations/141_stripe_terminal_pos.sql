-- =============================================================================
-- Migration 141: Stripe Terminal / POS Box Office
-- Feature #30: Physical in-venue sales via tablet + card reader
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS pos;

-- POS session: one session per staff member per event (shift)
CREATE TABLE IF NOT EXISTS pos.pos_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  promoter_id         UUID NOT NULL,
  staff_user_id       UUID NOT NULL,
  terminal_id         TEXT NOT NULL,          -- Stripe Terminal reader ID
  location_id         TEXT,                   -- Stripe Terminal location ID
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'reconciled')),
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at           TIMESTAMPTZ,
  reconciled_at       TIMESTAMPTZ
);

-- POS transaction: each card payment at the box office
CREATE TABLE IF NOT EXISTS pos.pos_transactions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                UUID NOT NULL REFERENCES pos.pos_sessions(id),
  order_id                  UUID,             -- NULL for walk-in cash (future)
  payment_intent_id         TEXT UNIQUE,      -- Stripe PaymentIntent ID
  terminal_reader_id        TEXT NOT NULL,
  amount_hellers            INT NOT NULL CHECK (amount_hellers > 0),
  currency                  TEXT NOT NULL DEFAULT 'CZK',
  status                    TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  ticket_types              JSONB NOT NULL DEFAULT '[]',  -- [{ticketTypeId, quantity, unitPrice}]
  payment_method_type       TEXT,             -- 'card_present', 'contactless', etc.
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at              TIMESTAMPTZ
);

-- POS reconciliation: end-of-shift summary
CREATE TABLE IF NOT EXISTS pos.pos_reconciliations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL UNIQUE REFERENCES pos.pos_sessions(id),
  total_transactions  INT NOT NULL DEFAULT 0,
  total_succeeded     INT NOT NULL DEFAULT 0,
  total_failed        INT NOT NULL DEFAULT 0,
  gross_amount_hellers BIGINT NOT NULL DEFAULT 0,
  net_amount_hellers  BIGINT NOT NULL DEFAULT 0,
  discrepancy_hellers INT NOT NULL DEFAULT 0,
  reconciled_by       UUID NOT NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_pos_sessions_event ON pos.pos_sessions(event_id);
CREATE INDEX idx_pos_sessions_promoter ON pos.pos_sessions(promoter_id);
CREATE INDEX idx_pos_transactions_session ON pos.pos_transactions(session_id);
CREATE INDEX idx_pos_transactions_order ON pos.pos_transactions(order_id);
