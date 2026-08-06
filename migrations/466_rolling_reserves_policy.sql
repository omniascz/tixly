--
-- 466_rolling_reserves_policy.sql — D4, druha vrstva
--
-- platform.rolling_reserves ma ENABLE ROW LEVEL SECURITY, ale NULA POLICIES.
-- To je TICHY DENY (§91): pod tixly_app nevidi radky NIKDO — ani servisni
-- kontext. Cron release-rolling-reserves proto vracel `releasedCount: 0`
-- a tvaril se uspesne, zatimco se neuvolnilo nic.
--
-- Zmereno: routa bezi v runWithServiceContext, UPDATE presto matchnul 0 radku,
-- ackoli v tabulce byla splatna rezerva.
--
-- Tvar je vzorec ze §81 — tataz podoba jako 19 tabulek v migraci 461.
-- Promoterska vetev tam patri: promoter ma na svoje zadrzene penize videt.
--
BEGIN;

DROP POLICY IF EXISTS p_rolling_reserves_scope ON platform.rolling_reserves;
CREATE POLICY p_rolling_reserves_scope ON platform.rolling_reserves
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

COMMIT;
