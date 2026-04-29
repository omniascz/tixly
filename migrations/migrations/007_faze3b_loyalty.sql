-- =============================================================================
-- MIGRACE 007: Schéma pro loyalty-points modul
-- Datum: 2026-04-05
-- Modul: C:\Users\omnia\Documents\tixly\loyalty-points\
-- Tabulky: loyalty.accounts, loyalty.transactions
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS loyalty;

-- ---------------------------------------------------------------------------
-- loyalty.accounts — stav věrnostního konta per uživatel
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty.accounts (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na identity.users — bez FK
  user_id         UUID          NOT NULL UNIQUE,
  -- Aktuální redeemovatelné body (může klesat při redemption)
  total_points    INTEGER       NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  -- Celoživotní earned body (nikdy neklesají — určují tier)
  lifetime_points INTEGER       NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
  -- Tier automaticky odvozený z lifetime_points:
  --   bronze:   0–4 999 lifetime pts
  --   silver:   5 000–19 999
  --   gold:    20 000–49 999
  --   platinum: 50 000+
  tier            TEXT          NOT NULL DEFAULT 'bronze'
    CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
  -- Expirační datum bodů (NULL = neexpirují)
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE loyalty.accounts IS
  'Věrnostní konto uživatele. Jeden záznam per user_id.
   tier je odvozený z lifetime_points (nikdy neklesá), nikoliv z total_points.';

COMMENT ON COLUMN loyalty.accounts.total_points IS
  'Aktuálně dostupné body k uplatnění. Klesá při redemption.';

COMMENT ON COLUMN loyalty.accounts.lifetime_points IS
  'Celkový součet kdy-kdy earned bodů. Nikdy neklesá — určuje tier (silver/gold/platinum).';

CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_tier
  ON loyalty.accounts(tier);

CREATE TRIGGER trg_loyalty_accounts_updated_at
  BEFORE UPDATE ON loyalty.accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- loyalty.transactions — audit log všech pohybů bodů
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty.transactions (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na identity.users — bez FK
  user_id     UUID          NOT NULL,
  -- Typ pohybu
  type        TEXT          NOT NULL
    CHECK (type IN ('earned', 'redeemed', 'expired', 'adjusted')),
  -- Počet bodů (kladný pro earned/adjusted+, záporný pro redeemed/expired/adjusted-)
  points      INTEGER       NOT NULL,
  -- Idempotency: jedna objednávka = jeden earned záznam
  -- NULL pro redemption, expiration, manual adjustment
  order_id    UUID,
  -- Popis pro zobrazení uživateli
  description TEXT          NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Idempotency: nesmí existovat dva 'earned' záznamy pro stejnou objednávku
  CONSTRAINT uq_loyalty_tx_order UNIQUE (user_id, order_id)
    DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE loyalty.transactions IS
  'Immutable log pohybů věrnostních bodů. Záznamy se nesmí mazat (audit trail).';

COMMENT ON COLUMN loyalty.transactions.order_id IS
  'UUID objednávky z orders.orders; NULL pro redemption/expiration. UNIQUE constraint zabraňuje duplicitním earned záznamům.';

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_user_id
  ON loyalty.transactions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_order_id
  ON loyalty.transactions(order_id)
  WHERE order_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS: uživatel vidí pouze svá data
-- ---------------------------------------------------------------------------
ALTER TABLE loyalty.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY loyalty_accounts_user ON loyalty.accounts
  FOR ALL USING (user_id = current_setting('app.current_user_id', TRUE)::UUID);
CREATE POLICY loyalty_accounts_service ON loyalty.accounts
  FOR ALL USING (current_setting('app.role', TRUE) IN ('service', 'admin'));

ALTER TABLE loyalty.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY loyalty_tx_user ON loyalty.transactions
  FOR SELECT USING (user_id = current_setting('app.current_user_id', TRUE)::UUID);
CREATE POLICY loyalty_tx_service ON loyalty.transactions
  FOR ALL USING (current_setting('app.role', TRUE) IN ('service', 'admin'));

-- ---------------------------------------------------------------------------
-- Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'loyalty' AND table_name = 'accounts'),
    'CHYBA: loyalty.accounts neexistuje';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'loyalty' AND table_name = 'transactions'),
    'CHYBA: loyalty.transactions neexistuje';
  RAISE NOTICE 'Migrace 007 (loyalty) úspěšně ověřena.';
END;
$$;

COMMIT;
