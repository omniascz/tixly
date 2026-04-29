-- =============================================================================
-- MIGRACE 023: Fraud queue — manuální review podezřelých objednávek
-- Datum: 2026-04-06
-- Závislosti: ticketing_schema.sql (orders.orders), 003_orders_extensions.sql
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS risk;

-- ---------------------------------------------------------------------------
-- 1. risk.fraud_cases
--    Jedna řádka = jedna podezřelá objednávka čekající na review.
--    Zdroj: automatický risk scoring při checkoutu (Kafka event / přímé volání).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk.fraud_cases (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID            NOT NULL,           -- orders.orders.id
  user_id         UUID            NOT NULL,           -- identity.users.id
  promoter_id     UUID,                               -- platform.promoters.id (nullable — platform order)
  event_id        UUID,                               -- catalog.events.id

  -- Finanční kontext
  amount_hellers  INTEGER         NOT NULL CHECK (amount_hellers >= 0),
  currency        CHAR(3)         NOT NULL DEFAULT 'CZK',

  -- Risk scoring
  risk_score      SMALLINT        NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  signals         JSONB           NOT NULL DEFAULT '[]',
    -- Pole objektů:
    -- [{ "rule": "velocity_check", "detail": "5 orders in 10 min from IP 1.2.3.4" },
    --  { "rule": "geo_mismatch",   "detail": "billing=CZ, ip=CN" }]

  -- Stav
  status          TEXT            NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'cleared', 'confirmed_fraud', 'escalated')),
  priority        TEXT            NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'critical')),

  -- Order byl při enqueue automaticky pozdržen (hold)?
  order_held      BOOLEAN         NOT NULL DEFAULT FALSE,

  -- Metadata
  ip_address      INET,
  user_agent      TEXT,
  country_code    CHAR(2),

  reviewed_by     UUID,           -- identity.users.id (admin)
  reviewed_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_fraud_case_order UNIQUE (order_id)   -- jedna objednávka = max. jeden případ
);

COMMENT ON TABLE risk.fraud_cases IS
  'Fronta podezřelých objednávek pro manuální review adminem.
   Enqueue je volán z checkout pipeline po překročení risk score prahu (≥ 60).';

COMMENT ON COLUMN risk.fraud_cases.signals IS
  'JSONB pole triggerovaných pravidel: [{ rule: string, detail: string, score: number }].
   Každé pravidlo přispívá část k celkovému risk_score.';

COMMENT ON COLUMN risk.fraud_cases.order_held IS
  'TRUE = objednávka byla automaticky pozastavena; vstupenky nejsou vydány do rozhodnutí.
   Clearing order deblokuje; confirm_fraud spouští cancel.';

CREATE INDEX IF NOT EXISTS idx_fraud_cases_status_priority
  ON risk.fraud_cases(status, priority DESC, created_at ASC)
  WHERE status = 'pending_review';

CREATE INDEX IF NOT EXISTS idx_fraud_cases_user
  ON risk.fraud_cases(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fraud_cases_order
  ON risk.fraud_cases(order_id);

-- updated_at trigger
CREATE OR REPLACE TRIGGER fraud_cases_updated_at
  BEFORE UPDATE ON risk.fraud_cases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. risk.fraud_reviews
--    Audit trail každého rozhodnutí admina. Case může mít víc reviews (escalate → clear).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk.fraud_reviews (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID            NOT NULL REFERENCES risk.fraud_cases(id),
  admin_user_id   UUID            NOT NULL,
  decision        TEXT            NOT NULL
    CHECK (decision IN ('clear', 'confirm_fraud', 'escalate', 'add_note')),
  notes           TEXT,           -- povinné pro confirm_fraud a escalate
  ban_buyer       BOOLEAN         NOT NULL DEFAULT FALSE,  -- při confirm_fraud: přidat do blacklistu?
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE risk.fraud_reviews IS
  'Každý review krok admina. Rozhodnutí ''clear'' a ''confirm_fraud'' jsou terminální.
   ''escalate'' mění prioritu na ''critical'' a přesune case do escalated stavu.
   ''add_note'' jen přidá poznámku bez změny stavu.';

CREATE INDEX IF NOT EXISTS idx_fraud_reviews_case
  ON risk.fraud_reviews(case_id, created_at ASC);

-- ---------------------------------------------------------------------------
-- 3. risk.fraud_rules
--    Konfigurace scoring pravidel — váhy a prahy pro každé pravidlo.
--    Seed hodnotami je naplněna níže. Admin může upravit přes UI.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk.fraud_rules (
  rule_name       TEXT            PRIMARY KEY,
  description     TEXT            NOT NULL,
  base_score      SMALLINT        NOT NULL CHECK (base_score BETWEEN 0 AND 100),
  enabled         BOOLEAN         NOT NULL DEFAULT TRUE,
  config          JSONB           NOT NULL DEFAULT '{}'
);

COMMENT ON TABLE risk.fraud_rules IS
  'Konfigurace risk scoring pravidel. base_score = příspěvek pravidla k celkovému risk_score.
   Celkový score = MIN(100, SUM(base_score pro každé triggerované pravidlo)).';

INSERT INTO risk.fraud_rules (rule_name, description, base_score, config)
VALUES
  ('velocity_check',
   'Více než N objednávek ze stejné IP nebo user_id za posledních M minut',
   35,
   '{"max_orders": 3, "window_minutes": 10}'),
  ('amount_anomaly',
   'Objednávka výrazně překračuje průměrný spend uživatele (nebo bezprecedentní výše)',
   25,
   '{"multiplier_threshold": 5.0, "absolute_min_hellers": 500000}'),
  ('geo_mismatch',
   'Fakturační země ≠ země IP adresy',
   20,
   '{}'),
  ('new_account',
   'Účet vytvořen méně než 24 hodin před nákupem',
   15,
   '{"min_account_age_hours": 24}'),
  ('card_testing',
   'Série malých částek (< 500 Kč) z jednoho platebního prostředku',
   40,
   '{"max_amount_hellers": 50000, "min_attempts": 3, "window_minutes": 30}'),
  ('promo_abuse',
   'Více než N uplatnění promo kódu ze stejné IP nebo zařízení',
   20,
   '{"max_redemptions": 2, "window_days": 7}'),
  ('device_fingerprint',
   'Zařízení je na blacklistu nebo sdíleno s dříve podvodnými účty',
   50,
   '{}'),
  ('chargeback_history',
   'Uživatel má historii chargeback objednávek',
   45,
   '{"min_chargebacks": 1}')
ON CONFLICT (rule_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'risk' AND table_name = 'fraud_cases'
  ), 'CHYBA: risk.fraud_cases neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'risk' AND table_name = 'fraud_reviews'
  ), 'CHYBA: risk.fraud_reviews neexistuje';

  ASSERT (SELECT COUNT(*) FROM risk.fraud_rules) >= 8,
    'CHYBA: fraud_rules seed data chybí';

  RAISE NOTICE 'Migrace 023 úspěšně ověřena.';
END;
$$;

COMMIT;
