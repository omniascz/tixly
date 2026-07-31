-- 287_events_subcategory.sql
-- Hierarchická taxonomie kategorií: TOP (category) + SUB (subcategory) + Format (event_type).
--
-- Před touto migrací byl `category` flat enum (concert, theatre, festival, sport, ...)
-- bez explicitní hierarchie. Promotér mohl mít category='theatre' + event_type='concert'
-- = nesmysl. Tato migrace ji uklidňuje:
--
--   - category zůstává jako TOP (music, theatre, comedy, sport, conference, family,
--     club, gastro, exhibition, education, other)
--   - subcategory přidaný — konkrétní žánr (concert_club, festival_multi, play, opera, ...)
--   - event_type přejmenovat významem na "Format" (physical | online | hybrid)
--
-- Backward compat: subcategory NULL = legacy event (nezalíznutá pre-launch akce).

BEGIN;

-- 1. ADD COLUMN subcategory (nullable, backward compat)
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS subcategory text;

CREATE INDEX IF NOT EXISTS idx_events_category_subcategory
  ON catalog.events(category, subcategory)
  WHERE status = 'published';

COMMENT ON COLUMN catalog.events.subcategory IS
  'SUB žánr per TOP kategorie. Viz src/lib/events/categories.ts pro complete tree. NULL = legacy event.';

-- 2. Konsolidace `category` hodnot — old enum → new TOP
-- Old: concert, festival, theatre, club_party, sports, conference, workshop, family, comedy, other
-- New: music, theatre, comedy, sport, conference, family, club, gastro, exhibition, education, other

UPDATE catalog.events SET
  subcategory = CASE category
    WHEN 'concert'    THEN 'concert_club'
    WHEN 'festival'   THEN 'festival_one_day'
    WHEN 'theatre'    THEN 'play'
    WHEN 'club_party' THEN 'club_party'
    WHEN 'sports'     THEN 'sport_other'
    WHEN 'conference' THEN 'conference_other'
    WHEN 'workshop'   THEN 'workshop_pro'
    WHEN 'family'     THEN 'family_other'
    WHEN 'comedy'     THEN 'standup'
    ELSE 'other_other'
  END
WHERE subcategory IS NULL;

-- Then remap TOP category:
UPDATE catalog.events SET category = CASE category
  WHEN 'concert'    THEN 'music'
  WHEN 'festival'   THEN 'music'
  WHEN 'club_party' THEN 'club'
  WHEN 'sports'     THEN 'sport'
  WHEN 'workshop'   THEN 'conference'
  -- theatre, comedy, conference, family, other zůstávají
  ELSE category
END
WHERE category IN ('concert', 'festival', 'club_party', 'sports', 'workshop');

-- 3. CHECK constraint na nové hodnoty (s graceful fallback pro old categories)
-- Pozn.: NE-bývalé hodnoty zůstávají (legacy), takže CHECK je permissive.

COMMIT;
