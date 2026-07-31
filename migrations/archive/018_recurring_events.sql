-- =============================================================================
-- MIGRACE 018: Podpora opakujících se událostí (recurring events)
-- Datum: 2026-04-06
-- Důvod:
--   Fitness studia, restaurace a coworking potřebují opakující se time sloty
--   (např. "Jóga každé pondělí a středu 18:00–19:30").
--   Stávající model předpokládá jednorázové eventy s pevným starts_at/ends_at.
--   Přidáváme recurrence_rule (iCal RRULE), slot_duration_min a parent_event_id
--   pro hierarchii opakující se série → konkrétní instance.
--
-- Datový model:
--   Parent event (is_recurring = TRUE, recurrence_rule nastaveno)
--     └─► Child event (parent_event_id = parent.id, konkrétní datum/čas)
--         └─► Tickets / reservations jsou vázány na child eventy
--
-- Příklady RRULE:
--   'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=12'      — 12× každé po a st
--   'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231' — každé po a st do konce roku
--   'FREQ=DAILY;INTERVAL=1;COUNT=30'         — každý den, 30× (restaurace)
--   NULL                                      — jednorázový event (default)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. catalog.events — přidat sloupce pro recurring events
-- ---------------------------------------------------------------------------

-- Příznak, zda jde o vzorový event (šablona pro generování instancí)
-- TRUE = parent template, FALSE/NULL = konkrétní instance nebo jednorázový event
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN catalog.events.is_recurring IS
  'TRUE = tento záznam je šablona opakující se série (parent).
   Konkrétní instance mají parent_event_id nastaveno a is_recurring = FALSE.
   Tickety se vždy prodávají na konkrétní instanci, ne na šablonu.';

-- iCal RRULE pro definici opakování (RFC 5545)
-- NULL pro jednorázové eventy a konkrétní instance
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS recurrence_rule TEXT;

COMMENT ON COLUMN catalog.events.recurrence_rule IS
  'iCal RRULE (RFC 5545) pro opakování série.
   Platné pouze pokud is_recurring = TRUE.
   Příklad: ''FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261231T000000Z''
   NULL pro jednorázové eventy.';

-- Délka time slotu v minutách (pro fitness lekce, restaurace, coworking)
-- NULL pro eventy bez pevné délky slotu (koncerty, divadlo)
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS slot_duration_min INTEGER
    CHECK (slot_duration_min IS NULL OR slot_duration_min > 0);

COMMENT ON COLUMN catalog.events.slot_duration_min IS
  'Délka jedné instance/slotu v minutách.
   Fitness: 60 (hodina jógy), Restaurace: 120 (2h obsazení stolu),
   Coworking: 480 (celý pracovní den).
   NULL pro eventy bez pevné délky (koncerty, festivaly).';

-- Odkaz na parent (šablonu) pro konkrétní instance
-- NULL pro jednorázové eventy a pro samotné šablony
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS parent_event_id UUID
    REFERENCES catalog.events(id) ON DELETE SET NULL;

COMMENT ON COLUMN catalog.events.parent_event_id IS
  'UUID rodičovského (template) eventu pro opakující se série.
   NULL pro jednorázové eventy a pro šablony samotné.
   Tickety se vázají na child instance (s parent_event_id), ne na šablonu.';

-- Pořadí instance v sérii (1 = první výskyt, 2 = druhý, ...)
-- Usnadňuje řazení, reporting a "přeskoč tuto instanci" logiku
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS recurrence_index INTEGER
    CHECK (recurrence_index IS NULL OR recurrence_index >= 1);

COMMENT ON COLUMN catalog.events.recurrence_index IS
  'Pořadí této instance v opakující se sérii (1-based).
   NULL pro jednorázové eventy a šablony.
   Použití: zobrazení "Lekce 3/12", přeskočení konkrétní instance.';

-- Zda je tato konkrétní instance zrušena (bez rušení celé série)
-- Umožňuje "zrušit jen pondělní lekci 12.5." bez dopadu na ostatní
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS recurrence_cancelled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN catalog.events.recurrence_cancelled IS
  'TRUE = tato konkrétní instance je zrušena (např. státní svátek).
   Neruší ostatní instance série. Šablona (parent) zůstává aktivní.
   Při zrušení instance odesílat Kafka event ''event.instance.cancelled''.';

-- ---------------------------------------------------------------------------
-- 2. Indexy pro efektivní dotazy na série a instance
-- ---------------------------------------------------------------------------

-- Všechny instance dané série (pro zobrazení kalendáře)
CREATE INDEX IF NOT EXISTS idx_catalog_events_parent_event_id
  ON catalog.events(parent_event_id)
  WHERE parent_event_id IS NOT NULL;

-- Šablony opakujících se sérií (pro admin přehled)
CREATE INDEX IF NOT EXISTS idx_catalog_events_is_recurring
  ON catalog.events(is_recurring)
  WHERE is_recurring = TRUE;

-- Instance v sérii seřazené dle pořadí (pro kalendářní zobrazení)
CREATE INDEX IF NOT EXISTS idx_catalog_events_parent_recurrence_index
  ON catalog.events(parent_event_id, recurrence_index)
  WHERE parent_event_id IS NOT NULL;

-- Aktivní (nezrušené) instance pro konkrétního promotéra — hlavní query pro kalendář
CREATE INDEX IF NOT EXISTS idx_catalog_events_recurring_active
  ON catalog.events(promoter_id, parent_event_id, starts_at)
  WHERE recurrence_cancelled = FALSE
    AND parent_event_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog'
      AND table_name = 'events'
      AND column_name = 'is_recurring'
  ), 'CHYBA: catalog.events.is_recurring neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog'
      AND table_name = 'events'
      AND column_name = 'recurrence_rule'
  ), 'CHYBA: catalog.events.recurrence_rule neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog'
      AND table_name = 'events'
      AND column_name = 'slot_duration_min'
  ), 'CHYBA: catalog.events.slot_duration_min neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog'
      AND table_name = 'events'
      AND column_name = 'parent_event_id'
  ), 'CHYBA: catalog.events.parent_event_id neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog'
      AND table_name = 'events'
      AND column_name = 'recurrence_index'
  ), 'CHYBA: catalog.events.recurrence_index neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog'
      AND table_name = 'events'
      AND column_name = 'recurrence_cancelled'
  ), 'CHYBA: catalog.events.recurrence_cancelled neexistuje';

  RAISE NOTICE 'Migrace 018 úspěšně ověřena — recurring events podpora přidána.';
END;
$$;

COMMIT;
