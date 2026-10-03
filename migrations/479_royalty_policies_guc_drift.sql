--
-- 479_royalty_policies_guc_drift.sql
--   lineups.royalty_agreements / royalty_ledger / artist_payouts — R-58 skupina royalty_*
--
-- ── Co bylo zmereno ──────────────────────────────────────────────────────────
-- Kazda z tabulek ma JEDINOU policy `*_svc` = current_setting('app.bypass_rls')='on'.
-- Ten GUC aplikace nikdy nenastavuje (R-58, FINDINGS_RLS §95, §197). Pod rolí
-- `tixly_app` proto:
--   • POST /api/admin/events/[id]/royalties          → 42501 (zalozeni smlouvy)
--   • POST /api/offers/[token]/respond  action=accept → 500 (prekopeni nabidky
--                                                        do smlouvy, servisni kontext)
-- Zmereno live testem tests/booking-settlement.live.test.ts (2026-10-03).
-- V produkci se to dnes neprojevi jen proto, ze prod bezi jako neondb_owner
-- (FINDINGS §209) — po prepnuti na tixly_app by cela vrstva honoraru zemrela.
--
-- ── Oprava ───────────────────────────────────────────────────────────────────
-- Stejny tvar jako u novych tabulek teze vrstvy (473, 475–477):
--   platform admin  OR  servisni kontext  OR  vlastni poradatel.
-- `app.bypass_rls` → `app_is_service()` je vecne totez, co autor zamyslel.
-- Vetev poradatele je NOVA: admin routes smluv a vyplat bezi v kontextu
-- poradatele (runAsPromoter), takze bez ni by nefungovaly ani po oprave GUC.
-- Ledger nema promoter_id → rozsah pres smlouvu.
--

BEGIN;

DROP POLICY IF EXISTS royalty_agreements_svc ON lineups.royalty_agreements;
DROP POLICY IF EXISTS p_royalty_agreements_scope ON lineups.royalty_agreements;
CREATE POLICY p_royalty_agreements_scope ON lineups.royalty_agreements
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

DROP POLICY IF EXISTS artist_payouts_svc ON lineups.artist_payouts;
DROP POLICY IF EXISTS p_artist_payouts_scope ON lineups.artist_payouts;
CREATE POLICY p_artist_payouts_scope ON lineups.artist_payouts
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

DROP POLICY IF EXISTS royalty_ledger_svc ON lineups.royalty_ledger;
DROP POLICY IF EXISTS p_royalty_ledger_scope ON lineups.royalty_ledger;
CREATE POLICY p_royalty_ledger_scope ON lineups.royalty_ledger
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR agreement_id IN (SELECT a.id FROM lineups.royalty_agreements a
                          WHERE a.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR agreement_id IN (SELECT a.id FROM lineups.royalty_agreements a
                          WHERE a.promoter_id = public.app_current_promoter_id()));

COMMIT;
