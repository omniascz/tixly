-- 324_tier3_schema_backfill.sql
-- TIER 3 schema backfill — tabulky a sloupce co fyzicky existují v dev DB
-- ale chyběly v migration souborech (drift z ad-hoc psql commands).
--
-- Bez této migrace by fresh deploy hodil "relation does not exist" pro:
--   - tickets.wristbands               (#8 RFID bind/topup/charge endpoints)
--   - tickets.wristband_transactions   (#8 RFID transaction log)
--   - marketing.affiliates             (#10 Skiddle Rep affiliate CRUD)
--   - orders.orders.affiliate_id       (#10 checkout commission link)
--   - orders.orders.affiliate_commission_minor  (#10 accrued commission)
--
-- Dumpováno z dev DB pg_dump 2026-05-23. Idempotent přes IF NOT EXISTS / DO $$.

BEGIN;

-- ── #8 RFID Wristbands ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tickets.wristbands (
  uid               text PRIMARY KEY,
  ticket_id         uuid NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  bound_at          timestamptz NOT NULL DEFAULT now(),
  bound_by_user_id  uuid REFERENCES identity.users(id),
  balance_halire    integer NOT NULL DEFAULT 0,
  active            boolean NOT NULL DEFAULT true,
  blocked_at        timestamptz,
  block_reason      text,
  notes             text,
  CONSTRAINT wristbands_balance_halire_check CHECK (balance_halire >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wristbands_active_per_ticket
  ON tickets.wristbands(ticket_id) WHERE active = true;

CREATE TABLE IF NOT EXISTS tickets.wristband_transactions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wristband_uid         text NOT NULL REFERENCES tickets.wristbands(uid) ON DELETE CASCADE,
  kind                  text NOT NULL,
  amount_halire         integer NOT NULL,
  balance_after         integer NOT NULL,
  vendor_label          text,
  description           text,
  payment_method        text,
  performed_by_user_id  uuid REFERENCES identity.users(id),
  performed_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wristband_transactions_balance_after_check CHECK (balance_after >= 0),
  CONSTRAINT wristband_transactions_kind_check
    CHECK (kind IN ('topup', 'purchase', 'refund', 'transfer', 'adjustment'))
);

CREATE INDEX IF NOT EXISTS idx_wb_tx_uid
  ON tickets.wristband_transactions(wristband_uid, performed_at DESC);

-- ── #10 Affiliate (Skiddle Rep) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing.affiliates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  email           text,
  commission_pct  integer NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  bank_account    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliates_commission_pct_check
    CHECK (commission_pct >= 0 AND commission_pct <= 50),
  CONSTRAINT affiliates_promoter_id_code_key UNIQUE (promoter_id, code)
);

CREATE INDEX IF NOT EXISTS affiliates_code_idx
  ON marketing.affiliates(code) WHERE active = true;

ALTER TABLE marketing.affiliates ENABLE ROW LEVEL SECURITY;

-- Drop+recreate policy idempotently (CREATE POLICY nemá IF NOT EXISTS)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'p_affiliates_tenant'
    AND polrelid = 'marketing.affiliates'::regclass
  ) THEN
    DROP POLICY p_affiliates_tenant ON marketing.affiliates;
  END IF;
END $$;

CREATE POLICY p_affiliates_tenant ON marketing.affiliates
  USING (public.app_is_platform_admin() OR (promoter_id = public.app_current_promoter_id()));

GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE marketing.affiliates TO tixly_app;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE tickets.wristbands TO tixly_app;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE tickets.wristband_transactions TO tixly_app;

-- ── #10 Orders affiliate columns ─────────────────────────────────────────

ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS affiliate_id uuid REFERENCES marketing.affiliates(id) ON DELETE SET NULL;

ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS affiliate_commission_minor bigint;

CREATE INDEX IF NOT EXISTS idx_orders_affiliate_id
  ON orders.orders(affiliate_id) WHERE affiliate_id IS NOT NULL;

COMMENT ON TABLE tickets.wristbands IS
  'Festival cashless RFID páska — bind ticket → UID, balance_halire pro stánky.';
COMMENT ON TABLE tickets.wristband_transactions IS
  'Append-only log topup/purchase operací nad wristband balance.';
COMMENT ON TABLE marketing.affiliates IS
  'Skiddle Rep style affiliate — promoter''s rep dostane unique code, commission per paid order.';

COMMIT;
