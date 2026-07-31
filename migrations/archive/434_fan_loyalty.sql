-- Migration 434: Fan Věrnostní Body (Fan Loyalty Points)
-- Platform-wide loyalty program: earn 1 bod / 10 Kč, redeem 1 bod = 1 Kč sleva

-- ─── Loyalty accounts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing.loyalty_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  points_balance bigint NOT NULL DEFAULT 0,
  lifetime_points bigint NOT NULL DEFAULT 0,
  tier text NOT NULL DEFAULT 'bronze',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE marketing.loyalty_accounts ADD CONSTRAINT loyalty_accounts_balance_check CHECK (points_balance >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS loyalty_accounts_user_idx ON marketing.loyalty_accounts (user_id);

ALTER TABLE marketing.loyalty_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY loyalty_accounts_owner ON marketing.loyalty_accounts
  FOR SELECT
  USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY loyalty_accounts_admin ON marketing.loyalty_accounts
  FOR ALL
  USING (current_setting('app.is_platform_admin', true) = 'true');

-- ─── Loyalty transactions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing.loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES marketing.loyalty_accounts(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders.orders(id) ON DELETE SET NULL,
  kind text NOT NULL,
  points_delta bigint NOT NULL,
  reason text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loyalty_tx_account_idx ON marketing.loyalty_transactions (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS loyalty_tx_order_idx ON marketing.loyalty_transactions (order_id);

ALTER TABLE marketing.loyalty_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY loyalty_tx_owner ON marketing.loyalty_transactions
  FOR SELECT
  USING (
    account_id IN (
      SELECT id FROM marketing.loyalty_accounts
      WHERE user_id::text = current_setting('app.current_user_id', true)
    )
  );

CREATE POLICY loyalty_tx_admin ON marketing.loyalty_transactions
  FOR ALL
  USING (current_setting('app.is_platform_admin', true) = 'true');

-- ─── Orders columns (denormalized reporting) ──────────────────────────────────
ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS loyalty_points_earned bigint;

ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS loyalty_points_redeemed bigint;

ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS loyalty_discount_halire bigint;
