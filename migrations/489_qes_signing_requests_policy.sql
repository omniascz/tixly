--
-- 489_qes_signing_requests_policy.sql
--   platform.qes_signing_requests — R-58 (drift jména GUC)
--
-- ── Co bylo změřeno (kolo 4, tests/fix-r4-qes-policy.live.test.ts) ─────────
-- Jediná policy `qes_requests_svc` = current_setting('app.bypass_rls')='on'. Ten GUC
-- aplikace nikdy nenastavuje (R-58). Pod rolí tixly_app proto řádek nevidí ani servisní
-- kontext: /api/mock-qes/[id] → 404, /api/qes/webhook nenajde žádost, admin/qes/sign-request
-- nezaloží žádost. Podepisování smluv pořadatelů (QES) pod produkční rolí nefunguje.
--
-- ── Oprava ───────────────────────────────────────────────────────────────────
-- Tvar jako u ostatních tabulek tenantu: platform admin OR servisní kontext OR vlastní
-- pořadatel. `app.bypass_rls` → `app_is_service()` je věcně totéž, co autor zamýšlel;
-- větev pořadatele je pro admin/qes/sign-request (běží v kontextu pořadatele).
-- Idempotentní (DROP IF EXISTS), lze pustit opakovaně.
--
BEGIN;

ALTER TABLE platform.qes_signing_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qes_requests_svc ON platform.qes_signing_requests;
DROP POLICY IF EXISTS p_qes_signing_requests_scope ON platform.qes_signing_requests;
CREATE POLICY p_qes_signing_requests_scope ON platform.qes_signing_requests
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

COMMIT;
