-- =============================================================================
-- MIGRACE 002: Přidat currency + timezone na catalog.events, locale na orders.orders
-- Datum: 2026-04-05
-- Důvod: Nevratná architektonická rozhodnutí před MVP — bez těchto sloupců
--        nelze zpětně přiřadit měnu/timezone starým akcím ani generovat
--        emaily/PDF ve správném jazyce pro historické objednávky.
-- =============================================================================

BEGIN;

-- 1. catalog.events: zdrojová měna akce
ALTER TABLE catalog.events
    ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'CZK';

COMMENT ON COLUMN catalog.events.currency IS
    'ISO 4217 zdrojová měna akce (CZK, EUR, …). Pevně daná při vytvoření, nelze měnit po spuštění prodeje.';

-- 2. catalog.events: IANA timezone místa konání
ALTER TABLE catalog.events
    ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'Europe/Prague';

COMMENT ON COLUMN catalog.events.timezone IS
    'IANA timezone name místa konání (Europe/Prague, Europe/Berlin, …). Používá se pro zobrazení času kupujícímu.';

-- 3. orders.orders: locale kupujícího
ALTER TABLE orders.orders
    ADD COLUMN IF NOT EXISTS locale VARCHAR(10) NOT NULL DEFAULT 'cs';

COMMENT ON COLUMN orders.orders.locale IS
    'Locale kupujícího při nákupu (cs, en, de, …). Používá se pro generování emailů a PDF vstupenek ve správném jazyce.';

-- Ověření
DO $$
BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'catalog' AND table_name = 'events' AND column_name = 'currency'
    ), 'CHYBA: catalog.events.currency neexistuje';

    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'catalog' AND table_name = 'events' AND column_name = 'timezone'
    ), 'CHYBA: catalog.events.timezone neexistuje';

    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'orders' AND table_name = 'orders' AND column_name = 'locale'
    ), 'CHYBA: orders.orders.locale neexistuje';

    RAISE NOTICE 'Migrace 002 úspěšně ověřena.';
END;
$$;

COMMIT;
