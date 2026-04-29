-- =============================================================================
-- MIGRACE 004: Rozšíření resale.resale_listings pro resale payout flow
-- Datum: 2026-04-05
-- Důvod:
--   resale-api.resale-listing.service.ts předpokládá sloupce:
--     commission_rate, reserved_until, payout_amount, payout_at,
--     payout_retry_count, manual_review
--   a statusy: 'reserved' (rezervace před GoPay capture), 'captured', 'voided'
--   Bez těchto rozšíření purchaseListing, claimTimeout a captureEscrow selhávají.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Nové sloupce
-- ---------------------------------------------------------------------------

-- Provizní sazba prodejce — kopie z event/platform nastavení při listingu
ALTER TABLE resale.resale_listings
  ADD COLUMN IF NOT EXISTS commission_rate INTEGER NOT NULL DEFAULT 0
    CHECK (commission_rate >= 0 AND commission_rate <= 10000);
  -- Basis points: 500 = 5.00 %, max 100 %

COMMENT ON COLUMN resale.resale_listings.commission_rate IS
  'Provize platformy v basis points (500 = 5 %). Kopie z platform.fee_schedules při vytvoření listingu.';

-- Časové okno rezervace po kliknutí "Koupit" — kupující má X minut na platbu
ALTER TABLE resale.resale_listings
  ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ;

COMMENT ON COLUMN resale.resale_listings.reserved_until IS
  'Platnost rezervace pro kupujícího (status=reserved). Po vypršení se listing vrátí do active.';

-- Částka k výplatě prodejci (ask_price - commission), nastavena při capture
ALTER TABLE resale.resale_listings
  ADD COLUMN IF NOT EXISTS payout_amount INTEGER
    CHECK (payout_amount IS NULL OR payout_amount >= 0);

COMMENT ON COLUMN resale.resale_listings.payout_amount IS
  'Čistá výplata prodejci v halířích (ask_price - commission). Nastavena při GoPay capture.';

-- Timestamp skutečné výplaty prodejci
ALTER TABLE resale.resale_listings
  ADD COLUMN IF NOT EXISTS payout_at TIMESTAMPTZ;

COMMENT ON COLUMN resale.resale_listings.payout_at IS
  'Kdy byla výplata odeslána prodejci. NULL = čeká na výplatu.';

-- Počet pokusů o výplatu (pro retry logiku)
ALTER TABLE resale.resale_listings
  ADD COLUMN IF NOT EXISTS payout_retry_count INTEGER NOT NULL DEFAULT 0
    CHECK (payout_retry_count >= 0);

COMMENT ON COLUMN resale.resale_listings.payout_retry_count IS
  'Počet pokusů o výplatu prodejci. Limit 3 — po překročení přechází na manuální review.';

-- Flag pro manuální review (compliance, podezřelé transakce)
ALTER TABLE resale.resale_listings
  ADD COLUMN IF NOT EXISTS manual_review BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN resale.resale_listings.manual_review IS
  'TRUE = transakce vyžaduje manuální schválení (compliance flag, payout failure > 3×).';

-- ---------------------------------------------------------------------------
-- 2. Rozšíření CHECK constraint pro status
--    Přidání 'reserved' (kupující klikl Koupit, čeká na GoPay preauth)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_constraint TEXT;
BEGIN
  SELECT tc.constraint_name INTO v_constraint
  FROM information_schema.table_constraints tc
  WHERE tc.table_schema = 'resale'
    AND tc.table_name = 'resale_listings'
    AND tc.constraint_type = 'CHECK'
    AND tc.constraint_name ILIKE '%status%'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE resale.resale_listings DROP CONSTRAINT %I', v_constraint);
    RAISE NOTICE 'Odstraněn status CHECK constraint: %', v_constraint;
  END IF;
END;
$$;

ALTER TABLE resale.resale_listings
  ADD CONSTRAINT resale_listings_status_check
  CHECK (status IN ('active', 'reserved', 'sold', 'cancelled', 'expired'));

COMMENT ON COLUMN resale.resale_listings.status IS
  'active → reserved (kupující klikl) → sold (GoPay captured + TOTP rotováno)
   nebo reserved → active (timeout / void) nebo active → cancelled/expired.';

-- ---------------------------------------------------------------------------
-- 3. Rozšíření CHECK constraint pro escrow_status
--    Přidání 'captured' (platba zachycena) a 'voided' (preauth zrušen)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_constraint TEXT;
BEGIN
  SELECT tc.constraint_name INTO v_constraint
  FROM information_schema.table_constraints tc
  WHERE tc.table_schema = 'resale'
    AND tc.table_name = 'resale_listings'
    AND tc.constraint_type = 'CHECK'
    AND tc.constraint_name ILIKE '%escrow_status%'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE resale.resale_listings DROP CONSTRAINT %I', v_constraint);
    RAISE NOTICE 'Odstraněn escrow_status CHECK constraint: %', v_constraint;
  END IF;
END;
$$;

ALTER TABLE resale.resale_listings
  ADD CONSTRAINT resale_listings_escrow_status_check
  CHECK (escrow_status IN ('none', 'held', 'captured', 'released', 'refunded', 'voided'));

COMMENT ON COLUMN resale.resale_listings.escrow_status IS
  'none → held (preauth) → captured (money taken) → released (paid out to seller)
   nebo held → voided (preauth cancelled) nebo captured → refunded (chargeback/dispute).';

-- ---------------------------------------------------------------------------
-- 4. Indexy pro nové sloupce
-- ---------------------------------------------------------------------------

-- Claim timeout joby: hledají reserved listingy s vypršenou rezervací
CREATE INDEX IF NOT EXISTS idx_resale_reserved_timeout
  ON resale.resale_listings(reserved_until ASC)
  WHERE status = 'reserved' AND reserved_until IS NOT NULL;

-- Payout joby: hledají sold listingy čekající na výplatu
CREATE INDEX IF NOT EXISTS idx_resale_payout_pending
  ON resale.resale_listings(sold_at ASC)
  WHERE status = 'sold' AND escrow_status = 'captured' AND payout_at IS NULL;

-- Manual review queue
CREATE INDEX IF NOT EXISTS idx_resale_manual_review
  ON resale.resale_listings(sold_at DESC)
  WHERE manual_review = TRUE;

-- ---------------------------------------------------------------------------
-- 5. Aktualizace logické konzistence CHECK constraintů
--    Stávající chk_resale_sold_consistency zakazuje sold bez buyer_id a sold_at —
--    s 'reserved' stavem je třeba opravit (reserved má buyer_id ale ne sold_at)
-- ---------------------------------------------------------------------------
ALTER TABLE resale.resale_listings
  DROP CONSTRAINT IF EXISTS chk_resale_sold_consistency;

ALTER TABLE resale.resale_listings
  ADD CONSTRAINT chk_resale_sold_consistency
  CHECK (
    (status = 'sold'     AND buyer_id IS NOT NULL AND sold_at IS NOT NULL)
    OR (status = 'reserved' AND buyer_id IS NOT NULL AND sold_at IS NULL)
    OR (status NOT IN ('sold', 'reserved'))
  );

-- ---------------------------------------------------------------------------
-- 6. Ověření
-- ---------------------------------------------------------------------------
DO $$
DECLARE col_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_schema = 'resale'
    AND table_name = 'resale_listings'
    AND column_name IN (
      'commission_rate', 'reserved_until', 'payout_amount',
      'payout_at', 'payout_retry_count', 'manual_review'
    );

  ASSERT col_count = 6,
    format('CHYBA: Očekáváno 6 nových sloupců, nalezeno %s', col_count);

  RAISE NOTICE 'Migrace 004 úspěšně ověřena: % nových sloupců.', col_count;
END;
$$;

COMMIT;
