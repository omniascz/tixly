-- 278_subscriptions_payment_status.sql
-- Subscription holder payment lifecycle — pending_payment → active.
-- Subscription checkout (commit 6fba923) vytvářel holder rovnou jako 'active',
-- což pro mock OK, ale pro produkci potřebujeme pending state před confirm.

BEGIN;

ALTER TABLE subscriptions.holders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'cancelled', 'refunded')),
  ADD COLUMN IF NOT EXISTS payment_id text,
  ADD COLUMN IF NOT EXISTS payment_provider text DEFAULT 'mock',
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- Rozšířit status CHECK constraint o 'pending_payment' (drop+add)
ALTER TABLE subscriptions.holders DROP CONSTRAINT IF EXISTS holders_status_check;
ALTER TABLE subscriptions.holders ADD CONSTRAINT holders_status_check
  CHECK (status IN ('pending_payment', 'active', 'suspended', 'cancelled', 'expired'));

CREATE INDEX IF NOT EXISTS idx_subs_holders_payment_id ON subscriptions.holders(payment_id)
  WHERE payment_id IS NOT NULL;

COMMENT ON COLUMN subscriptions.holders.payment_status IS
  'pending → paid (po payment success) → refunded (po refund)';

COMMIT;
