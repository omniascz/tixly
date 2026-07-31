-- =============================================================================
-- MIGRACE 105: Referral-system — sjednocení peněz na INTEGER haléře
-- Datum: 2026-04-11
-- Modul: referral-system
--
-- Důvod:
--   Původní migrace 090 používala NUMERIC(14,2) *_czk sloupce kvůli
--   kompatibilitě se service vrstvou, která v tu chvíli pracovala s CZK
--   (celé koruny s desetinami). Služby parsovaly NUMERIC přes parseInt(),
--   což v praxi tiše zahazovalo haléře — latentní bug (BUG-008).
--
--   Tato migrace sjednocuje všechny peněžní sloupce na INTEGER haléře
--   (stejná konvence jako zbytek Ticketariu — *_halire INTEGER).
--
-- Dopad:
--   1. referral.links                — drop total_earned_czk, add total_earned_halire
--   2. referral.conversions          — drop order_amount_czk, earned_czk;
--                                      add order_amount_halire, earned_halire
--   3. referral.credit_wallet        — drop *_czk; add *_halire
--   4. referral.credit_transactions  — drop amount_czk; amount_halire NOT NULL
--
--   Backfill: haléře = ROUND(czk * 100).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- referral.links
-- ---------------------------------------------------------------------------
ALTER TABLE referral.links
  ADD COLUMN IF NOT EXISTS total_earned_halire INTEGER NOT NULL DEFAULT 0
    CHECK (total_earned_halire >= 0);

UPDATE referral.links
   SET total_earned_halire = ROUND(COALESCE(total_earned_czk, 0) * 100)::INTEGER
 WHERE total_earned_halire = 0
   AND total_earned_czk IS NOT NULL
   AND total_earned_czk > 0;

ALTER TABLE referral.links DROP COLUMN IF EXISTS total_earned_czk;

-- ---------------------------------------------------------------------------
-- referral.conversions
-- ---------------------------------------------------------------------------
ALTER TABLE referral.conversions
  ADD COLUMN IF NOT EXISTS order_amount_halire INTEGER NULL
    CHECK (order_amount_halire IS NULL OR order_amount_halire >= 0);
ALTER TABLE referral.conversions
  ADD COLUMN IF NOT EXISTS earned_halire INTEGER NULL
    CHECK (earned_halire IS NULL OR earned_halire >= 0);

UPDATE referral.conversions
   SET order_amount_halire = ROUND(order_amount_czk * 100)::INTEGER,
       earned_halire       = ROUND(earned_czk * 100)::INTEGER
 WHERE order_amount_halire IS NULL;

ALTER TABLE referral.conversions
  ALTER COLUMN order_amount_halire SET NOT NULL;
ALTER TABLE referral.conversions
  ALTER COLUMN earned_halire SET NOT NULL;

ALTER TABLE referral.conversions DROP COLUMN IF EXISTS order_amount_czk;
ALTER TABLE referral.conversions DROP COLUMN IF EXISTS earned_czk;

-- ---------------------------------------------------------------------------
-- referral.credit_wallet
-- ---------------------------------------------------------------------------
ALTER TABLE referral.credit_wallet
  ADD COLUMN IF NOT EXISTS balance_halire INTEGER NOT NULL DEFAULT 0
    CHECK (balance_halire >= 0);
ALTER TABLE referral.credit_wallet
  ADD COLUMN IF NOT EXISTS lifetime_earned_halire INTEGER NOT NULL DEFAULT 0
    CHECK (lifetime_earned_halire >= 0);
ALTER TABLE referral.credit_wallet
  ADD COLUMN IF NOT EXISTS lifetime_spent_halire INTEGER NOT NULL DEFAULT 0
    CHECK (lifetime_spent_halire >= 0);

UPDATE referral.credit_wallet
   SET balance_halire         = ROUND(COALESCE(balance_czk, 0) * 100)::INTEGER,
       lifetime_earned_halire = ROUND(COALESCE(lifetime_earned_czk, 0) * 100)::INTEGER,
       lifetime_spent_halire  = ROUND(COALESCE(lifetime_spent_czk, 0) * 100)::INTEGER
 WHERE balance_halire = 0 AND lifetime_earned_halire = 0 AND lifetime_spent_halire = 0;

ALTER TABLE referral.credit_wallet DROP COLUMN IF EXISTS balance_czk;
ALTER TABLE referral.credit_wallet DROP COLUMN IF EXISTS lifetime_earned_czk;
ALTER TABLE referral.credit_wallet DROP COLUMN IF EXISTS lifetime_spent_czk;

-- ---------------------------------------------------------------------------
-- referral.credit_transactions
--
-- Migrace 090 již měla amount_halire (nullable). Zde backfillujeme z amount_czk,
-- pak sloupec zahodíme a amount_halire zpřísníme na NOT NULL.
-- ---------------------------------------------------------------------------
UPDATE referral.credit_transactions
   SET amount_halire = ROUND(amount_czk * 100)::INTEGER
 WHERE amount_halire IS NULL
   AND amount_czk IS NOT NULL;

ALTER TABLE referral.credit_transactions
  ALTER COLUMN amount_halire SET NOT NULL;

-- CHECK(amount_czk IS NOT NULL OR amount_halire IS NOT NULL) drop před
-- odstraněním amount_czk, jinak by ALTER selhal na závislosti.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
    FROM pg_constraint
   WHERE conrelid = 'referral.credit_transactions'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%amount_czk IS NOT NULL OR amount_halire IS NOT NULL%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE referral.credit_transactions DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE referral.credit_transactions DROP COLUMN IF EXISTS amount_czk;

COMMIT;
