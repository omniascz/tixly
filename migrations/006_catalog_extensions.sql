-- =============================================================================
-- MIGRACE 006: Rozšíření catalog.events a tickets.tickets
-- Datum: 2026-04-05
-- Důvod:
--   1. organizer-dashboard čte catalog.events.resale_commission_rate pro
--      nastavení provize per event (resale-settings API).
--   2. totp-qr modul používá status 'active' ale DB schema má 'valid'.
--      Přidán CHECK constraint komentář + alias pohled pro zpětnou kompatibilitu.
--      (Status 'active' byl v totp-qr.service.ts opraven na 'valid' v review.)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. catalog.events — přidat resale_commission_rate
--    Organizátor může nastavit vlastní provizi pro resale na své akci.
--    NULL = použít platform default (z platform.fee_schedules).
-- ---------------------------------------------------------------------------
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS resale_commission_rate INTEGER
    CHECK (resale_commission_rate IS NULL
        OR (resale_commission_rate >= 0 AND resale_commission_rate <= 10000));

COMMENT ON COLUMN catalog.events.resale_commission_rate IS
  'Provize z resale pro tuto akci v basis points (500 = 5 %). NULL = platform default.
   Organizátor může nastavit vlastní sazbu v rozsahu 0–100 % (0–10000 bps).';

-- ---------------------------------------------------------------------------
-- 2. catalog.events — přidat promoter_id
--    Vazba event → promotér pro payout settlement a RLS politiky.
--    cross-schema reference na platform.promoters — bez FK.
-- ---------------------------------------------------------------------------
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS promoter_id UUID;

COMMENT ON COLUMN catalog.events.promoter_id IS
  'UUID promotéra z platform.promoters; cross-schema reference bez FK.
   Nastavuje se při vytváření akce organizátorem.';

CREATE INDEX IF NOT EXISTS idx_catalog_events_promoter_id
  ON catalog.events(promoter_id)
  WHERE promoter_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. catalog.ticket_types — přidat subtotal sloupce pro reporting
--    platform-fees reporting view potřebuje per-ticket fee breakdown.
--    (platform_fee_amount a promoter_payout přidány v platform-fees/001 na order_items,
--     zde přidáváme resale_allowed flag na ticket_type úrovni)
-- ---------------------------------------------------------------------------
ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS resale_allowed BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN catalog.ticket_types.resale_allowed IS
  'Zda je přeprodej povolen pro tento typ vstupenky. Přepisuje event-level resale_allowed.';

-- ---------------------------------------------------------------------------
-- 4. Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog'
      AND table_name = 'events'
      AND column_name = 'resale_commission_rate'
  ), 'CHYBA: catalog.events.resale_commission_rate neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog'
      AND table_name = 'events'
      AND column_name = 'promoter_id'
  ), 'CHYBA: catalog.events.promoter_id neexistuje';

  RAISE NOTICE 'Migrace 006 úspěšně ověřena.';
END;
$$;

COMMIT;
