-- Payment Plan engine — Stripe Customer mapping pro splátky.
--
-- Existing tables: catalog.payment_plans (template), orders.payment_installments.
-- Co chybí: persistent Stripe Customer ID per user + saved payment_method_id pro recurring charging.

BEGIN;

ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT;

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer
  ON identity.users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

COMMENT ON COLUMN identity.users.stripe_customer_id IS
  'Persistent Stripe Customer ID — vytvořen při prvním checkoutu s payment plan; používá se pro charging installments.';
COMMENT ON COLUMN orders.orders.stripe_payment_method_id IS
  'Stripe PaymentMethod ID z initial checkout sessionu s setup_future_usage. Cron charge-installments ho použije pro automatic strhávání splátek.';

-- Splatky cron retry tracking
ALTER TABLE orders.payment_installments
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payment_installments_due
  ON orders.payment_installments (due_at, status)
  WHERE status IN ('pending', 'retrying');

COMMIT;
