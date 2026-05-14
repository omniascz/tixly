-- Benefit Payments — CZ benefitní karty/kupóny (Pluxee/Sodexo, Benefit Plus, Gallery Beta).
--
-- Flow:
--   1. Buyer si v checkoutu zvolí benefit_pluxee/benefit_plus/benefit_gallery_beta
--   2. Server vytvoří order status='pending' + benefit_payment row, vrátí redirect URL
--   3. Buyer dokončí na portálu poskytovatele
--   4. Provider callback → markne paid → trigger order-completed
--
-- Bez vendor credentials je flow mock (redirect na /mock-benefit/[provider]/[id]).

BEGIN;

CREATE TABLE orders.benefit_payments (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID         NOT NULL UNIQUE,
  provider        TEXT         NOT NULL
    CHECK (provider IN ('pluxee', 'benefit_plus', 'gallery_beta', 'edenred')),
  external_id     TEXT,
  amount_halire   INTEGER      NOT NULL CHECK (amount_halire > 0),
  status          TEXT         NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'redirected', 'paid', 'cancelled', 'failed')),
  redirect_url    TEXT,
  callback_payload JSONB,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_benefit_payments_external
  ON orders.benefit_payments (provider, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX idx_benefit_payments_status
  ON orders.benefit_payments (status, created_at DESC);

COMMENT ON TABLE orders.benefit_payments IS
  'CZ benefitní platby — Pluxee/Sodexo Šek, Benefit Plus, Gallery Beta. Real integration vyžaduje vendor API klíče.';

COMMIT;
