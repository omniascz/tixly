-- 289_reimbursement_methods.sql
-- TM Parity Fáze 1: Reimbursement Method
--
-- Při resale prodeji (=peer-to-peer): pokud akce zrušena → Tixly strhne kupní cenu
-- z prodávajícího (refunduje kupujícího). Vyžadujeme tokenized kartu od sellera.
--
-- Skladované jen jako provider token (GoPay/Stripe), nikdy plný PAN.

BEGIN;

CREATE TABLE IF NOT EXISTS payments.reimbursement_methods (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  provider            text NOT NULL DEFAULT 'gopay'
                        CHECK (provider IN ('gopay', 'stripe', 'comgate')),
  provider_token      text NOT NULL,
  card_last4          text,
  card_brand          text,
  card_exp_month      integer,
  card_exp_year       integer,
  is_default          boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  verified_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reimbursement_user
  ON payments.reimbursement_methods(user_id)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_reimbursement_default_user
  ON payments.reimbursement_methods(user_id)
  WHERE is_default = true AND is_active = true;

COMMENT ON TABLE payments.reimbursement_methods IS
  'Tokenized payment method pro refund obligations (TM-style). Užívá se hlavně u resale.';

-- Refund hold log (audit když Tixly strhne z reimbursement card)
CREATE TABLE IF NOT EXISTS payments.reimbursement_holds (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reimbursement_id    uuid NOT NULL REFERENCES payments.reimbursement_methods(id),
  user_id             uuid NOT NULL REFERENCES identity.users(id),
  amount_halire       integer NOT NULL CHECK (amount_halire > 0),
  currency            text NOT NULL DEFAULT 'CZK',
  related_order_id    uuid REFERENCES orders.orders(id),
  related_event_id    uuid REFERENCES catalog.events(id),
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'captured', 'failed', 'reversed')),
  captured_at         timestamptz,
  provider_response   jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reimbursement_holds_user
  ON payments.reimbursement_holds(user_id, status);

COMMIT;
