-- CZ + SK launch batch migration
--
-- Přidává:
--   1) platform.promoters.country (CZ / SR) — určuje DPH sazby a default fee
--   2) platform.promoters.primary_currency (CZK / EUR) — default měna promotéra
--   3) platform.fee_schedules.buyer_fee_halire — servisní fee placený kupcem
--   4) platform.fee_schedules.currency — fee schedule per měna
--   5) catalog.events.refund_deadline_days (INT, default 7)
--   6) catalog.events.refund_fee_pct (INT BPS, default 500 = 5 %)
--   7) catalog.events.qr_policy (ENUM 4 levels)
--   8) catalog.events.vat_category (ENUM standard/cultural/food/merch)
--   9) platform.promoters.chargeback_holdback_pct (INT BPS, default per tier)
--   10) platform.promoters.chargeback_holdback_days (INT, default 90)

BEGIN;

-- =============================================================================
-- 1. PROMOTÉR — country, primary_currency, holdback config
-- =============================================================================

ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'CZ'
    CHECK (country IN ('CZ', 'SR'));

ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS primary_currency TEXT NOT NULL DEFAULT 'CZK'
    CHECK (primary_currency IN ('CZK', 'EUR'));

-- Chargeback holdback policy — tier-based defaults, ale per-promotér override
ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS chargeback_holdback_pct INTEGER
    CHECK (chargeback_holdback_pct IS NULL OR (chargeback_holdback_pct >= 0 AND chargeback_holdback_pct <= 2000));
  -- NULL = použij tier default (tier 1: 500, tier 2: 300, tier 3+: 0). Override = explicit value.

ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS chargeback_holdback_days INTEGER
    CHECK (chargeback_holdback_days IS NULL OR (chargeback_holdback_days >= 0 AND chargeback_holdback_days <= 365));

COMMENT ON COLUMN platform.promoters.country IS
  'CZ = Česká republika, SR = Slovenská republika. Určuje default DPH sazby a měnu.';
COMMENT ON COLUMN platform.promoters.primary_currency IS
  'Primární měna promotéra. CZ promotér default CZK, SR default EUR. Promotér může mít akce v obou měnách.';
COMMENT ON COLUMN platform.promoters.chargeback_holdback_pct IS
  'Override holdback %. NULL = tier default (T1: 500 bps, T2: 300 bps, T3+: 0).';
COMMENT ON COLUMN platform.promoters.chargeback_holdback_days IS
  'Override holdback retention days. NULL = tier default (T1: 90, T2: 60, T3+: 0).';

-- Auto-set SR → EUR pokud admin vyplní country=SR
CREATE OR REPLACE FUNCTION platform.set_default_currency_for_country()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.country = 'SR' AND OLD.country IS DISTINCT FROM 'SR'
     AND NEW.primary_currency = OLD.primary_currency THEN
    NEW.primary_currency := 'EUR';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_promoters_default_currency ON platform.promoters;
CREATE TRIGGER trg_promoters_default_currency
  BEFORE UPDATE ON platform.promoters
  FOR EACH ROW
  EXECUTE FUNCTION platform.set_default_currency_for_country();

-- =============================================================================
-- 2. FEE SCHEDULES — buyer_fee + currency support
-- =============================================================================

ALTER TABLE platform.fee_schedules
  ADD COLUMN IF NOT EXISTS buyer_fee_halire INTEGER NOT NULL DEFAULT 0
    CHECK (buyer_fee_halire >= 0);

ALTER TABLE platform.fee_schedules
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CZK'
    CHECK (currency IN ('CZK', 'EUR'));

ALTER TABLE platform.fee_schedules
  ADD COLUMN IF NOT EXISTS override_reason TEXT;

COMMENT ON COLUMN platform.fee_schedules.buyer_fee_halire IS
  'Servisní poplatek pro kupce (per objednávka). Default 0 = pouze procentní fee z promotéra.';
COMMENT ON COLUMN platform.fee_schedules.currency IS
  'Měna fee schedule. CZK pro CZ promotéry, EUR pro SR. Lookup matches order currency.';
COMMENT ON COLUMN platform.fee_schedules.override_reason IS
  'Důvod pro custom sazbu (např. "kulturní dům", "charita", "objem >1M CZK/rok"). Audit trail.';

CREATE INDEX IF NOT EXISTS idx_fee_schedules_lookup
  ON platform.fee_schedules (promoter_id, currency, is_active, valid_from, valid_until);

-- =============================================================================
-- 3. EVENT — refund policy + qr_policy + vat_category
-- =============================================================================

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS refund_deadline_days INTEGER
    CHECK (refund_deadline_days IS NULL OR refund_deadline_days >= 0);
  -- NULL = použij platform default (7 dní). Promotér může nastavit 0 (no refund) až 90.

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS refund_fee_pct INTEGER
    CHECK (refund_fee_pct IS NULL OR (refund_fee_pct >= 0 AND refund_fee_pct <= 10000));
  -- NULL = default 500 (5 %). 0 = full refund, 10000 = no refund (= refund_deadline_days=0).

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS refund_fee_min_halire INTEGER
    CHECK (refund_fee_min_halire IS NULL OR refund_fee_min_halire >= 0);
  -- NULL = default 30 CZK / 120 EUR cents. Minimum fee pokud % je menší.

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS qr_policy TEXT NOT NULL DEFAULT 'static_allowed'
    CHECK (qr_policy IN ('static_allowed', 'rotating_24h', 'rotating_only', 'photo_required'));

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS vat_category TEXT NOT NULL DEFAULT 'cultural'
    CHECK (vat_category IN ('standard', 'cultural', 'food_beverage', 'merchandise', 'reduced'));

COMMENT ON COLUMN catalog.events.refund_deadline_days IS
  'Self-service refund dostupný do X dní před akcí. NULL = platform default (7). 0 = no refund.';
COMMENT ON COLUMN catalog.events.refund_fee_pct IS
  'Refund fee v basis points (500 = 5 %). NULL = default. Aplikuje se na vrácenou částku.';
COMMENT ON COLUMN catalog.events.qr_policy IS
  'static_allowed (PDF + mobile fungují) | rotating_24h (PDF stažen 24h před) | rotating_only (jen mobile) | photo_required (Level 3 — vyžaduje foto).';
COMMENT ON COLUMN catalog.events.vat_category IS
  'standard (21 CZ / 23 SR) | cultural (10 CZ / 5 SR) | food_beverage (12 CZ / 19 SR) | merchandise (21 CZ / 23 SR) | reduced (10 CZ / 5 SR).';

CREATE INDEX IF NOT EXISTS idx_events_qr_policy
  ON catalog.events (qr_policy)
  WHERE qr_policy != 'static_allowed';

-- =============================================================================
-- 4. PLATFORM CONFIG — globální defaulty (1 row)
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform.config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

INSERT INTO platform.config (key, value) VALUES
  ('default_refund_deadline_days', '7'::jsonb),
  ('default_refund_fee_bps', '500'::jsonb),
  ('default_refund_fee_min_halire_czk', '3000'::jsonb),
  ('default_refund_fee_min_halire_eur', '120'::jsonb),
  ('vat_rates', '{
    "CZ": {"standard": 21, "cultural": 10, "food_beverage": 12, "merchandise": 21, "reduced": 10},
    "SR": {"standard": 23, "cultural": 5, "food_beverage": 19, "merchandise": 23, "reduced": 5}
  }'::jsonb),
  ('default_fee_pct_bps_cz', '{
    "small": 700, "medium": 500, "large": 400, "charity": 200
  }'::jsonb),
  ('default_buyer_fee_halire_cz', '{
    "small": 1000, "medium": 1000, "large": 1500, "charity": 0
  }'::jsonb),
  ('default_buyer_fee_halire_sr', '{
    "small": 40, "medium": 40, "large": 60, "charity": 0
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE platform.config IS
  'Globální konfigurace platformy. Single-row per klíč, JSONB value pro flexibilitu.';

COMMIT;
