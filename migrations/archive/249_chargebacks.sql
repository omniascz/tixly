-- Chargebacks — structured tabulka pro Stripe disputes.
-- Webhook už zaloguje dispute_created do audit.audit_log; tady mu dáme
-- normalizovaný state pro UX (status, holdback, evidence_submitted_at).

BEGIN;

CREATE TABLE IF NOT EXISTS orders.chargebacks (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                 UUID         NOT NULL,
  promoter_id              UUID         NOT NULL REFERENCES platform.promoters(id),
  stripe_dispute_id        TEXT         UNIQUE,
  stripe_charge_id         TEXT,
  amount_halire            INTEGER      NOT NULL,
  reason                   TEXT,
  status                   TEXT         NOT NULL DEFAULT 'needs_response'
    CHECK (status IN ('needs_response', 'under_review', 'won', 'lost', 'warning_closed')),
  holdback_applied         BOOLEAN      NOT NULL DEFAULT FALSE,
  evidence_submitted_at    TIMESTAMPTZ,
  closed_at                TIMESTAMPTZ,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chargebacks_promoter_status
  ON orders.chargebacks (promoter_id, status, created_at DESC);

CREATE INDEX idx_chargebacks_order
  ON orders.chargebacks (order_id);

COMMENT ON COLUMN orders.chargebacks.holdback_applied IS
  'TRUE = částka byla stržena z budoucího payout settlement. Spočítá se v admin/payouts.';

COMMIT;
