-- 281_cleanup_orphan_venues.sql
-- P2: 274/280 venues = orphan (promoter_id ukazuje na neexistujícího).
-- Pre-step pro 282_promoter_fk_constraints (FK nelze ADD pokud existují orphans).
--
-- Pozn.: Tato migrace je destruktivní pro dev seed data. Pro production NEPOUŽÍVAT
-- bez review — venues mohou být legitimní data před akvizicí promotera.

BEGIN;

-- Před DELETE: ověř že žádné catalog.events neukazují na tyto venues
-- (events.venue_id FK by mělo zabránit, ale jistota)
DO $$
DECLARE
  ev_count integer;
BEGIN
  SELECT count(*) INTO ev_count
    FROM catalog.events e
   WHERE e.venue_id IN (
     SELECT v.id FROM catalog.venues v
      WHERE v.promoter_id NOT IN (SELECT id FROM platform.promoters)
   );
  IF ev_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete orphan venues: % events still reference them. Reassign events first.', ev_count;
  END IF;
END $$;

DELETE FROM catalog.venues
 WHERE promoter_id IS NOT NULL
   AND promoter_id NOT IN (SELECT id FROM platform.promoters);

COMMIT;
