-- 500_productions_card.sql
--   Kolo 8 / krok 1 — inscenace jako karta představení zadaná jednou; termín (catalog.events) ji
--   přebírá a smí jen doplnit.
--
-- POUŽITO: catalog.productions (id, promoter_id, title, slug) + catalog.events.production_id
--          (existující, RLS p_productions_scope z mig. 461 — promoter_id = kontext pořadatele).
-- NOVĚ: sloupce karty inscenace; na termínu jen doplňky (poznámka k termínu, alternace obsazení).
-- Veřejné čtení: inscenace, které mají aspoň jeden publikovaný termín (politika p_productions_public_read).
-- Idempotentní.

ALTER TABLE catalog.productions
  ADD COLUMN IF NOT EXISTS subtitle          text,
  ADD COLUMN IF NOT EXISTS description       text,
  ADD COLUMN IF NOT EXISTS author            text,
  ADD COLUMN IF NOT EXISTS director          text,
  ADD COLUMN IF NOT EXISTS cast_list         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS duration_min      integer CHECK (duration_min IS NULL OR duration_min BETWEEN 1 AND 1440),
  ADD COLUMN IF NOT EXISTS intermission_min  integer CHECK (intermission_min IS NULL OR intermission_min BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS age_rating        text,
  ADD COLUMN IF NOT EXISTS genre             text,
  ADD COLUMN IF NOT EXISTS photos            jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS video_url         text,
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now(),
  -- OPRAVENO: onboarding (krok inscenace) a /api/v1/publish/events vkládají poster_url a status, které
  -- v DB nikdy nebyly (drift guard je hlásil jako chybějící author/description) → obě cesty padaly 42703.
  ADD COLUMN IF NOT EXISTS poster_url        text,
  ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'published';

ALTER TABLE catalog.productions DROP CONSTRAINT IF EXISTS productions_cast_list_array;
ALTER TABLE catalog.productions ADD CONSTRAINT productions_cast_list_array CHECK (jsonb_typeof(cast_list) = 'array');
ALTER TABLE catalog.productions DROP CONSTRAINT IF EXISTS productions_photos_array;
ALTER TABLE catalog.productions ADD CONSTRAINT productions_photos_array CHECK (jsonb_typeof(photos) = 'array');

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS term_note        text,
  ADD COLUMN IF NOT EXISTS cast_alternation text;

COMMENT ON COLUMN catalog.events.term_note IS 'Kolo 8: poznámka k termínu (doplněk k inscenaci).';
COMMENT ON COLUMN catalog.events.cast_alternation IS 'Kolo 8: alternace obsazení pro tento termín (doplněk k inscenaci).';

CREATE INDEX IF NOT EXISTS idx_events_production ON catalog.events (production_id) WHERE production_id IS NOT NULL;

-- Veřejná stránka inscenace: číst smí kdokoli, pokud má inscenace publikovaný termín.
DROP POLICY IF EXISTS p_productions_public_read ON catalog.productions;
CREATE POLICY p_productions_public_read ON catalog.productions
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM catalog.events e WHERE e.production_id = productions.id AND e.status = 'published'));

-- OPRAVENO (zjištěno při stavbě kroku 1): catalog.venues neměl veřejné čtení (jen p_venues_tenant = vlastní
-- pořadatel), takže veřejná stránka akce ukazovala místo sálu „Online" a program neznal město.
-- Veřejně čitelný je sál, který má publikovanou akci, nebo sál bez vlastníka (sdílená knihovna).
DROP POLICY IF EXISTS p_venues_public_read ON catalog.venues;
CREATE POLICY p_venues_public_read ON catalog.venues
  FOR SELECT
  USING (promoter_id IS NULL
         OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.venue_id = venues.id AND e.status = 'published'));
