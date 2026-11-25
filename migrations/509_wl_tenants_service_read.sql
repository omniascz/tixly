-- 509_wl_tenants_service_read.sql
--   25. 11. 2026 — white-label API vracelo vždy 401.
--
-- PŘÍČINA: platform.whitelabel_tenants má jedinou politiku wl_tenants_admin (jen app.is_platform_admin).
--          verifyWlToken (src/lib/whitelabel/tenant-auth.ts) hledá tenanta podle hashe klíče v servisním
--          kontextu pod rolí tixly_app (NOBYPASSRLS) → 0 řádků → každý požadavek na /api/v1/wl/* = 401.
-- OPRAVA:  servisní kontext smí tenanty ČÍST (jen SELECT). Zápis zůstává jen správci platformy.
-- Idempotentní.

DROP POLICY IF EXISTS svc_read_whitelabel_tenants ON platform.whitelabel_tenants;
CREATE POLICY svc_read_whitelabel_tenants ON platform.whitelabel_tenants FOR SELECT
  USING (public.app_is_service());
