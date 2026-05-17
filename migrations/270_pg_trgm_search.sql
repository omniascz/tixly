-- Migration 270: pg_trgm full-text search + typo tolerance
--
-- Aktivuje rozšíření pg_trgm (Postgres trigram matching) a vytváří GIN indexy
-- nad title/description/venue.name/venue.city. Po této migraci umí
-- semantic-search používat:
--   - operator `%>` (trigram similarity match) — robustní na překlepy
--   - funkci similarity(a, b) pro ranking (0..1)
--   - operator `ILIKE` zůstává funkční pro exact substring match
--
-- Příklad query po migraci:
--   SELECT * FROM catalog.events
--   WHERE title % 'praha'        -- trigram match, tolerance ~ 0.3
--   ORDER BY similarity(title, 'praha') DESC;
--
-- Neon Postgres má pg_trgm jako trusted extension, instalace bez super-userů.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Default similarity threshold pro `%` operátor (0.3 je defaultní hodnota,
-- nezvyšujeme, jinak by `Praha` neodpovídal `Prague`).

CREATE INDEX IF NOT EXISTS idx_events_title_trgm
  ON catalog.events USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_events_description_trgm
  ON catalog.events USING GIN (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_venues_name_trgm
  ON catalog.venues USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_venues_city_trgm
  ON catalog.venues USING GIN (city gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_promoters_name_trgm
  ON platform.promoters USING GIN (name gin_trgm_ops);

COMMIT;
