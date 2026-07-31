-- 310_rls_extended_tenant_isolation.sql
-- Rozšíření RLS na všechny zbývající tabulky s promoter_id.
-- Z 38 → cca 130 tabulek (defense in depth).

BEGIN;

DO $$
DECLARE
  t_record record;
  policy_name text;
BEGIN
  FOR t_record IN
    SELECT DISTINCT t.schemaname, t.tablename
      FROM pg_tables t
      JOIN information_schema.columns c
        ON c.table_schema = t.schemaname AND c.table_name = t.tablename
     WHERE c.column_name = 'promoter_id'
       AND t.schemaname NOT IN ('pg_catalog','information_schema')
       AND NOT t.rowsecurity
  LOOP
    policy_name := 'p_' || t_record.tablename || '_tenant';

    -- Enable RLS
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
                   t_record.schemaname, t_record.tablename);

    -- Drop existing (idempotent re-run)
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   policy_name, t_record.schemaname, t_record.tablename);

    -- Tenant isolation policy
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL USING (' ||
      '  app_is_platform_admin() OR ' ||
      '  promoter_id = app_current_promoter_id() OR ' ||
      '  promoter_id IS NULL' ||  -- platform-wide rows (eg. sandbox fixtures, global addons)
      ')',
      policy_name, t_record.schemaname, t_record.tablename
    );
  END LOOP;
END $$;

INSERT INTO public.schema_migrations (filename)
VALUES ('310_rls_extended_tenant_isolation.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
