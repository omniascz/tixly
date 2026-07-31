-- =============================================================================
-- MIGRACE 017: event_type a venue_type pro podporu nových vertikál
-- Datum: 2026-04-06
-- Důvod:
--   Platforma se rozrůstá za koncepty, budoucí vertikály:
--     - SaaS pro fitness studia (lekce, členství)
--     - Restaurace / rezervace stolů (floor plan, time sloty)
--     - Pronájem prostorů (coworking, sály, studia)
--     - Virtuální eventy / streamy (tokenizovaný přístup)
--   Přidáváme event_type a venue_type jako základ pro filtrování,
--   routing a vertikálně-specifickou logiku bez breaking change.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. catalog.events — přidat event_type
--    Rozlišení druhu události pro routing, UI a business logiku.
--    DEFAULT 'concert' zachovává chování všech existujících záznamů.
-- ---------------------------------------------------------------------------
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'concert'
    CHECK (event_type IN (
      'concert',               -- hudební koncert, festival
      'sport',                 -- sportovní utkání, závod
      'conference',            -- konference, seminář, přednáška
      'cinema',                -- filmové promítání
      'theatre',               -- divadlo, opera, balet
      'comedy',                -- stand-up, improvizace
      'exhibition',            -- výstava, galerie, muzeum
      'fitness_class',         -- hodina jógy, pilates, spinning atd.
      'restaurant_reservation',-- rezervace stolu v restauraci
      'space_rental',          -- pronájem coworkingu, sálu, studia
      'virtual_stream',        -- online stream, webinář, živé vysílání
      'other'                  -- vše ostatní
    ));

COMMENT ON COLUMN catalog.events.event_type IS
  'Druh události. Řídí UI, validaci a business logiku per-vertikála.
   DEFAULT ''concert'' zachovává kompatibilitu se stávajícími záznamy.
   fitness_class a restaurant_reservation typicky kombinují is_recurring = TRUE.';

CREATE INDEX IF NOT EXISTS idx_catalog_events_event_type
  ON catalog.events(event_type);

CREATE INDEX IF NOT EXISTS idx_catalog_events_event_type_promoter
  ON catalog.events(event_type, promoter_id)
  WHERE promoter_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. catalog.venues — přidat venue_type
--    Typ prostoru ovlivňuje seat-map rendering, kapacitní logiku a UI.
--    DEFAULT 'venue' zachovává chování všech existujících záznamů.
-- ---------------------------------------------------------------------------
ALTER TABLE catalog.venues
  ADD COLUMN IF NOT EXISTS venue_type TEXT NOT NULL DEFAULT 'venue'
    CHECK (venue_type IN (
      'venue',         -- obecný koncertní/společenský sál
      'stadium',       -- sportovní stadion (velká kapacita, sektory)
      'arena',         -- multifunkční hala (sport, koncerty)
      'cinema_hall',   -- kinosál (řady, čísla sedadel)
      'theatre_hall',  -- divadelní sál (přízemí, balkón, lóže)
      'club',          -- klub (standing room, bary)
      'outdoor',       -- venkovní areál, amfiteátr
      'fitness_studio',-- studio pro lekce (rohože/místa, ne sedadla)
      'restaurant',    -- restaurace (stoly jako "sektory")
      'coworking',     -- coworking prostor (stoly, místnosti)
      'conference_room',-- konferenční místnost
      'online'         -- virtuální prostor (bez fyzické mapy)
    ));

COMMENT ON COLUMN catalog.venues.venue_type IS
  'Typ prostoru. Určuje chování seat-map komponenty a kapacitní logiku.
   fitness_studio: místa = rohože/stanoviště (ne sedadla).
   restaurant: sektory = stoly, kapacita = počet hostů u stolu.
   online: žádná fyzická mapa, kapacita = max. concurrent streamů.
   DEFAULT ''venue'' zachovává kompatibilitu se stávajícími záznamy.';

CREATE INDEX IF NOT EXISTS idx_catalog_venues_venue_type
  ON catalog.venues(venue_type);

-- ---------------------------------------------------------------------------
-- 3. Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog'
      AND table_name = 'events'
      AND column_name = 'event_type'
  ), 'CHYBA: catalog.events.event_type neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog'
      AND table_name = 'venues'
      AND column_name = 'venue_type'
  ), 'CHYBA: catalog.venues.venue_type neexistuje';

  RAISE NOTICE 'Migrace 017 úspěšně ověřena — event_type a venue_type přidány.';
END;
$$;

COMMIT;
