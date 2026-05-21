-- 303_rls_expansion_tenant_isolation.sql
-- Defense in depth: zapnout RLS na všechny tenant-owned tabulky s promoter_id.
-- Aplikace se primárně spoléhá na WHERE clauses, ale RLS poskytne fail-safe
-- pro případ kde WHERE chybí.
--
-- Policy pattern: app_is_platform_admin() bypass + promoter_id = app_current_promoter_id()
--
-- Tabulky: 22 critical tenant tables (venues, marketing, finance, branding, ...).
-- Audit tables (platform_log, anomaly_alerts) zůstávají bez RLS — admin čte cross-tenant.

BEGIN;

-- ============================================================
-- Helper: idempotentní RLS setup makro (re-runnable)
-- ============================================================
DO $$
DECLARE
  t_schema text;
  t_name text;
  t_policy text;
  targets text[][] := ARRAY[
    -- catalog tenant data
    ['catalog', 'venues'],
    ['catalog', 'cross_pass_bundles'],
    ['catalog', 'payment_plans'],
    ['catalog', 'event_ticket_defaults'],
    ['catalog', 'insurance_plans'],
    ['catalog', 'sales_channels'],
    -- event groups
    ['event_groups', 'groups'],
    -- marketing per-promotér
    ['marketing', 'affiliates'],
    ['marketing', 'event_broadcasts'],
    ['marketing', 'sms_campaigns'],
    ['marketing', 'support_faq'],
    -- platform per-promoter config
    ['platform', 'email_templates'],
    ['platform', 'member_groups'],
    ['platform', 'refund_policies'],
    ['platform', 'bank_credentials'],
    ['platform', 'promoter_branding'],
    ['platform', 'promoter_documents'],
    ['platform', 'promoter_domains'],
    ['platform', 'promoter_members'],
    ['platform', 'team_invites'],
    -- notifications
    ['notifications', 'promoter_notifications']
  ];
  i int;
BEGIN
  FOR i IN 1..array_length(targets, 1) LOOP
    t_schema := targets[i][1];
    t_name := targets[i][2];
    t_policy := 'p_' || t_name || '_tenant';

    -- Skip if table missing
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = t_schema AND tablename = t_name
    ) THEN
      RAISE NOTICE 'SKIP: %.% does not exist', t_schema, t_name;
      CONTINUE;
    END IF;

    -- Enable RLS
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t_schema, t_name);

    -- Drop existing same-named policy (idempotent re-run)
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', t_policy, t_schema, t_name);

    -- Create tenant isolation policy
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL USING (' ||
      '  app_is_platform_admin() OR ' ||
      '  promoter_id = app_current_promoter_id()' ||
      ')',
      t_policy, t_schema, t_name
    );

    RAISE NOTICE 'RLS enabled on %.%', t_schema, t_name;
  END LOOP;
END $$;

-- ============================================================
-- Speciální: public.checkout_addons — má promoter_id i event_id
-- ============================================================
ALTER TABLE public.checkout_addons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_checkout_addons_tenant ON public.checkout_addons;
CREATE POLICY p_checkout_addons_tenant ON public.checkout_addons
  FOR ALL
  USING (
    app_is_platform_admin() OR
    promoter_id = app_current_promoter_id()
  );

-- ============================================================
-- Bezpečnostní pojistka: tixly_app role respektuje RLS
-- (superuser tixly ji obchází, což je správně pro migrace/admin queries)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN
    -- tixly_app NESMÍ být BYPASSRLS
    EXECUTE 'ALTER ROLE tixly_app NOBYPASSRLS';
  END IF;
END $$;

INSERT INTO public.schema_migrations (filename)
VALUES ('303_rls_expansion_tenant_isolation.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
