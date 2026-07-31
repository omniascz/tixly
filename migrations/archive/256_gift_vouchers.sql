-- Dárkové poukazy (gift vouchers) — nominální hodnota nebo konkrétní akce.
--
-- Voucher má kód, nominální hodnotu, balance (může se uplatnit částečně),
-- expiraci. Buyer ho zadá v checkoutu jako platební metodu (sleva = balance).
--
-- Promoter scope: pokud `promoter_id` set, voucher platí jen na akce tohoto
-- promotéra. NULL = generic Tixly voucher (vzácné).
-- Event scope: pokud `event_id` set, voucher platí jen na konkrétní akci.

BEGIN;

CREATE TABLE marketing.gift_vouchers (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT         NOT NULL UNIQUE,
  promoter_id     UUID REFERENCES platform.promoters(id) ON DELETE CASCADE,
  event_id        UUID,
  amount_halire   INTEGER      NOT NULL CHECK (amount_halire > 0),
  balance_halire  INTEGER      NOT NULL CHECK (balance_halire >= 0),
  currency        TEXT         NOT NULL DEFAULT 'CZK',
  issued_to_email TEXT,
  issued_by_user  UUID,
  expires_at      TIMESTAMPTZ,
  fully_used_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_voucher_balance CHECK (balance_halire <= amount_halire)
);

CREATE INDEX idx_gift_vouchers_code
  ON marketing.gift_vouchers (code)
  WHERE balance_halire > 0;

CREATE INDEX idx_gift_vouchers_promoter
  ON marketing.gift_vouchers (promoter_id, created_at DESC);

CREATE INDEX idx_gift_vouchers_email
  ON marketing.gift_vouchers (issued_to_email)
  WHERE issued_to_email IS NOT NULL;

CREATE TABLE marketing.gift_voucher_redemptions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id      UUID         NOT NULL REFERENCES marketing.gift_vouchers(id) ON DELETE CASCADE,
  order_id        UUID         NOT NULL,
  amount_redeemed_halire INTEGER NOT NULL CHECK (amount_redeemed_halire > 0),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_voucher_redemptions_voucher
  ON marketing.gift_voucher_redemptions (voucher_id);

CREATE INDEX idx_voucher_redemptions_order
  ON marketing.gift_voucher_redemptions (order_id);

COMMENT ON TABLE marketing.gift_vouchers IS
  'Dárkové poukazy — nominální hodnota uplatněna v checkoutu jako sleva.';

COMMIT;
