-- RLS Fáze 2, Vlna A: first-pass policy pro tabulky bez RLS (větev feature/rls-phase2-enforcement).
-- NEslučovat do master bez staging validace + review (viz níže).
--
-- Generuje policy podle vzoru tenant sloupce (deny-by-default — žádný public-read
-- fallback, radši pod-exponovat než leaknout; published-read řeší explicitně migrace 330
-- u golden-path tabulek):
--   user_id     → vlastník (app_current_user_id)
--   promoter_id → promotér (app_current_promoter_id)
--   event_id    → přes akci promotéra
--   order_id    → přes parent objednávku (vlastník || promotér akce)
-- Vždy + app_is_platform_admin() || app_is_service().
--
-- POZOR (review nutný před flipem): vzor předpokládá, že user_id/promoter_id = VLASTNÍK.
-- Pokud je nějaký user_id ve skutečnosti created_by, policy je moc přísná (skryje řádky)
-- → vyjde najevo ve staging validaci jako "0 řádků". Dvojznačné (18) a bez-tenant (159)
-- tabulky tahle migrace ZÁMĚRNĚ vynechává.

DO $$
DECLARE
  r RECORD;
  pol text;
  polname text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, c.relname AS tbl,
      bool_or(a.attname = 'user_id')     AS u,
      bool_or(a.attname = 'promoter_id') AS p,
      bool_or(a.attname = 'event_id')    AS e,
      bool_or(a.attname = 'order_id')    AS o
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relkind = 'r' AND c.relrowsecurity = false
      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public', 'audit')
    GROUP BY n.nspname, c.relname
  LOOP
    IF r.u AND NOT r.p AND NOT r.e AND NOT r.o THEN
      pol := 'app_is_platform_admin() OR app_is_service() OR user_id = app_current_user_id()';
    ELSIF r.p AND NOT r.u THEN
      pol := 'app_is_platform_admin() OR app_is_service() OR promoter_id = app_current_promoter_id()';
    ELSIF r.e AND NOT r.u AND NOT r.p THEN
      pol := 'app_is_platform_admin() OR app_is_service() OR EXISTS '
          || '(SELECT 1 FROM catalog.events e_ WHERE e_.id = event_id '
          || 'AND e_.promoter_id = app_current_promoter_id())';
    ELSIF r.o AND NOT r.u AND NOT r.p AND NOT r.e THEN
      pol := 'app_is_platform_admin() OR app_is_service() OR EXISTS '
          || '(SELECT 1 FROM orders.orders o_ WHERE o_.id = order_id AND '
          || '(o_.user_id = app_current_user_id() OR EXISTS '
          || '(SELECT 1 FROM catalog.events ev_ WHERE ev_.id = o_.event_id '
          || 'AND ev_.promoter_id = app_current_promoter_id())))';
    ELSE
      CONTINUE; -- dvojznačné / bez tenant sloupce → na manuální review
    END IF;

    polname := 'p_rls_' || r.tbl;
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.sch, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', polname, r.sch, r.tbl);
    EXECUTE format('CREATE POLICY %I ON %I.%I FOR ALL USING (%s)', polname, r.sch, r.tbl, pol);
  END LOOP;
END $$;

-- Sjednotit poslední divergentní policy: platform.promoters používala app.tenant_id.
DROP POLICY IF EXISTS platform_promoters_promoter ON platform.promoters;
CREATE POLICY p_promoters_scope ON platform.promoters FOR ALL
  USING (app_is_platform_admin() OR app_is_service() OR id = app_current_promoter_id());
