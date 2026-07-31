-- =============================================================================
-- MIGRACE 003: Rozšíření orders.orders pro multi-promotér a payout logiku
-- Datum: 2026-04-05
-- Důvod:
--   payout-management čte orders.orders.event_id a orders.orders.promoter_id
--   pro výpočet settlement per event. promoter_id přidán v rls-multitenancy/002,
--   ale event_id a stav 'chargeback' chybí ve všech migracích.
-- Závislosti: musí běžet PO rls-multitenancy/002_add_promoter_columns.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. orders.orders — přidat event_id
--    Slouží k rychlé identifikaci akce v settlement dotazech bez JOIN na order_items.
--    Nastavuje se při vytváření objednávky ze service vrstvy.
-- ---------------------------------------------------------------------------
ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS event_id UUID;

COMMENT ON COLUMN orders.orders.event_id IS
  'UUID akce z catalog.events; cross-schema reference bez FK. Slouží pro payout settlement per event.';

CREATE INDEX IF NOT EXISTS idx_orders_event_id
  ON orders.orders(event_id, status)
  WHERE event_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. orders.orders — přidat 'chargeback' do CHECK constraint pro status
--    Stávající constraint byl: ('pending', 'paid', 'cancelled', 'refunded', 'expired')
--    Po přidání chargebacku: + 'chargeback'
--
--    PostgreSQL autogeneruje název inline CHECK jako {table}_{column}_check.
--    Pro tabulku orders.orders (schema orders) je název: orders_status_check
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_constraint TEXT;
BEGIN
  -- Najdeme aktuální název CHECK constraintu pro sloupec status
  SELECT tc.constraint_name INTO v_constraint
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
   AND tc.table_schema = ccu.table_schema
  WHERE tc.table_schema = 'orders'
    AND tc.table_name = 'orders'
    AND tc.constraint_type = 'CHECK'
    AND ccu.column_name = 'status'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE orders.orders DROP CONSTRAINT %I', v_constraint);
    RAISE NOTICE 'Odstraněn CHECK constraint: %', v_constraint;
  END IF;
END;
$$;

ALTER TABLE orders.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded', 'expired', 'chargeback'));

COMMENT ON COLUMN orders.orders.status IS
  'Stav objednávky: pending → paid → (refunded | expired | chargeback) nebo pending → cancelled.
   chargeback: kupující zpochybnil platbu u banky — platba stornována bankou.';

-- ---------------------------------------------------------------------------
-- 3. Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'orders' AND table_name = 'orders' AND column_name = 'event_id'
  ), 'CHYBA: orders.orders.event_id neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'orders'
      AND table_name = 'orders'
      AND constraint_name = 'orders_status_check'
  ), 'CHYBA: orders_status_check constraint neexistuje';

  RAISE NOTICE 'Migrace 003 úspěšně ověřena.';
END;
$$;

COMMIT;
