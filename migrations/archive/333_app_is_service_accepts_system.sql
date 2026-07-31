-- RLS Fáze 2, Vlna C fix: app_is_service() musí akceptovat i 'system'.
-- Service kontext (runWithServiceContext) nově nastavuje app.role='system' místo
-- 'service' — protože audit_log trigger čte app.role jako actor_type a CHECK constraint
-- povoluje jen user/system/admin/platform_admin/gate ('service' padalo).
-- Aby service operace měly dál plný RLS přístup, app_is_service() přijímá 'system' i 'service'.

CREATE OR REPLACE FUNCTION public.app_is_service() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.role', true), ''), '') IN ('service', 'admin', 'system');
$$;
