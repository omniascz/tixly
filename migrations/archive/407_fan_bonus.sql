-- Migration 407: FanBonus — 2-3 % cashback po nákupu vstupenky
-- Vydáno jako platform-wide gift voucher (promoter_id=NULL → platí na všech akcích).
-- Promotér konfiguruje per-event; kupující dostane kód emailem → zadá při příštím nákupu.

-- Per-event konfigurace
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS fan_bonus_enabled boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fan_bonus_pct     numeric(4,2)  NOT NULL DEFAULT 2.50;
-- fan_bonus_pct: doporučeno 2.0–3.0, max 10.0

-- Sledovací tabulka: která objednávka vygenerovala který voucher
-- Primární klíč na order_id → přirozená idempotence
CREATE TABLE IF NOT EXISTS marketing.fan_bonus_issued (
  order_id      uuid         PRIMARY KEY REFERENCES orders.orders(id),
  voucher_id    uuid         NOT NULL REFERENCES marketing.gift_vouchers(id),
  event_id      uuid         NOT NULL REFERENCES catalog.events(id),
  user_id       uuid         REFERENCES identity.users(id),
  earned_halire integer      NOT NULL CHECK (earned_halire > 0),
  bonus_pct     numeric(4,2) NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fan_bonus_issued_user  ON marketing.fan_bonus_issued (user_id);
CREATE INDEX IF NOT EXISTS idx_fan_bonus_issued_event ON marketing.fan_bonus_issued (event_id);

COMMENT ON TABLE marketing.fan_bonus_issued IS
  'Sleduje gift vouchery vydané jako FanBonus cashback. order_id PK = idempotence.';
