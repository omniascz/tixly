-- 280_events_slug.sql
-- P0: catalog.events nemá sloupec `slug`, ale 9+ produkčních endpointů ho čte.
-- Bez sloupce SQL fails. Backfill heuristikou z title (kebab-case + uniqueness).

BEGIN;

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS slug text;

-- Backfill: lower + diakritika remove + non-alnum → '-' + collapse + trim '-'
-- + sufix `-<id-prefix>` pro uniqueness per promoter
UPDATE catalog.events
   SET slug =
     regexp_replace(
       regexp_replace(
         lower(translate(title,
           'áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ',
           'acdeeinorstuuyzacdeeinorstuuyz'
         )),
         '[^a-z0-9]+', '-', 'g'
       ),
       '(^-|-$)', '', 'g'
     ) || '-' || substring(id::text FROM 1 FOR 6)
 WHERE slug IS NULL;

ALTER TABLE catalog.events
  ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_slug_per_promoter
  ON catalog.events(promoter_id, slug);

COMMENT ON COLUMN catalog.events.slug IS
  'URL-safe identifier per promoter. Auto-backfilled z title + id-prefix pro uniqueness.';

COMMIT;
