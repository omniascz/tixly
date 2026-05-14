-- Loyalty Program — body za nákup s tier systémem.
--
-- Earning: po order_completed → 1 bod za každých 10 Kč gross (před DPH).
-- Tiers (lifetime points):
--   Bronze   <  500   (1× multiplier)
--   Silver   500-2000 (1.1×)
--   Gold     2000+    (1.25×)
-- Redemption: v checkoutu, 1 bod = 1 Kč sleva, max 50% z order_total.
-- Expiration: body expirují 24 měsíců od získání (FIFO).

BEGIN;

CREATE TABLE marketing.loyalty_accounts (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE UNIQUE,
  points_balance  INTEGER      NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  lifetime_points INTEGER      NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
  tier            TEXT         NOT NULL DEFAULT 'bronze'
    CHECK (tier IN ('bronze', 'silver', 'gold')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_loyalty_accounts_user
  ON marketing.loyalty_accounts (user_id);

CREATE TABLE marketing.loyalty_transactions (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID         NOT NULL REFERENCES marketing.loyalty_accounts(id) ON DELETE CASCADE,
  points_delta  INTEGER      NOT NULL,
  kind          TEXT         NOT NULL
    CHECK (kind IN ('earn_purchase', 'redeem_checkout', 'expire', 'adjustment_admin')),
  reason        TEXT,
  order_id      UUID,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_loyalty_tx_account
  ON marketing.loyalty_transactions (account_id, created_at DESC);

CREATE INDEX idx_loyalty_tx_order
  ON marketing.loyalty_transactions (order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX idx_loyalty_tx_expiring
  ON marketing.loyalty_transactions (expires_at)
  WHERE expires_at IS NOT NULL AND points_delta > 0;

COMMENT ON COLUMN marketing.loyalty_accounts.points_balance IS
  'Aktuální nezredeemovaný balance po expirations. Pro UI display.';
COMMENT ON COLUMN marketing.loyalty_accounts.lifetime_points IS
  'Kumulativně získané body včetně redeemed (pro tier upgrade). Nikdy se nesnižuje při redemption.';
COMMENT ON COLUMN marketing.loyalty_transactions.kind IS
  'earn_purchase = order_completed, redeem_checkout = aplikováno při čekoutu, expire = 24mo cleanup, adjustment_admin = manual super-admin.';

COMMIT;
