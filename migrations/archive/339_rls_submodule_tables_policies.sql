-- RLS Fáze 2 — policy review vlna 4 (finální): 3 sub-modul child tabulky
-- scoped na promotéra přes 1-hop FK (exhibitor→promoter, package→promoter).
-- Po této migraci nemá žádná RLS-off tabulka tenant/PII signál.

-- conference.booth_assignments + exhibitor_sessions → exhibitor → promoter
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conference.booth_assignments','conference.exhibitor_sessions'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS p_scope ON %s', t);
    EXECUTE format($f$
      CREATE POLICY p_scope ON %1$s FOR ALL USING (
        app_is_service() OR app_is_platform_admin()
        OR EXISTS (SELECT 1 FROM conference.exhibitors ex
                    WHERE ex.id = %1$s.exhibitor_id AND ex.promoter_id = app_current_promoter_id())
      )$f$, t);
  END LOOP;
END $$;

-- reservations.package_items → package → promoter
ALTER TABLE reservations.package_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_scope ON reservations.package_items;
CREATE POLICY p_scope ON reservations.package_items FOR ALL USING (
  app_is_service() OR app_is_platform_admin()
  OR EXISTS (SELECT 1 FROM reservations.packages p
              WHERE p.id = package_items.package_id AND p.promoter_id = app_current_promoter_id())
);
