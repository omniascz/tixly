-- 351_rls_admin_tail_isolation.sql
--
-- RLS Fáze 2 — "admin tail" izolace (2026-06-08).
--
-- Kontext: empirický audit (scripts/audit-admin-rls.mjs) projel 147 tabulek
-- čtených /api/admin + /api/platform pod NOBYPASSRLS rolí. Výsledek:
--   • 0 LOCKOUTŮ (žádná tabulka, kde RLS=on a admin i promotér vidí 0) →
--     flip NOBYPASSRLS admin UI NEROZBIJE.
--   • 7 tabulek mělo RLS ÚPLNĚ VYPNUTÉ → bez tenant izolace (leak risk, ne lockout).
--
-- Tato migrace zapíná RLS na 4 z těch 7, u kterých je to bezpečné (ověřeny
-- VŠECHNY read cesty, aby policy nevrátila 0 řádků žádné legitimní route):
--
--   1. event_groups.shares      — cross-tenant leak: promotér viděl sdílení CIZÍCH
--                                  skupin. Čteno jen v promoter kontextu (2 routes).
--   2. marketing.promo_codes     — cross-tenant leak: promotér A mohl číst promo kódy
--                                  promotéra B (zneužití slevy). Čteno v promoter
--                                  (admin správa) + service (checkout/validate).
--   3. catalog.venue_seating_charts — sdílená reference (master admin maluje, promotér
--                                  i public seat-map jen čtou). Read-all + write admin.
--   4. catalog.moderation_blocklist — globální keyword config. Read-all + write admin.
--
-- VĚDOMĚ ODLOŽENO (Tier C, samostatně po codemod cleanupu — viz rls-phase2-plan.md):
--   • audit.audit_log — zapisuje se ze VŠECH kontextů (vč. DB triggeru na UPDATE
--     orders/tickets). Špatná INSERT policy by rozbila refundy/transfery platform-wide.
--     Append-only trail, nízká citlivost; read scoping vyřešit zvlášť.
--   • catalog.ticket_type_access — čteno i public buyer page + scanner BEZ kontextu;
--     potřebuje public-read + scanner service wrap napřed.
--   • tickets.wristband_transactions — 3 ze 4 RFID routes nemají context wrapper
--     (bind/charge/topup) → nejdřív codemod, pak RLS.
--
-- Idiom (shodný s migr. 331/346/350): svc_* = service plný; p_*_tenant = admin|owner;
-- p_*_read/_pub = veřejné/sdílené čtení. Policy jsou PERMISSIVE (OR-ují se).

-- ── 1. event_groups.shares — owner|sharee čtou, owner|admin zapisuje ──────────
ALTER TABLE event_groups.shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS svc_event_groups_shares ON event_groups.shares;
CREATE POLICY svc_event_groups_shares ON event_groups.shares
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

DROP POLICY IF EXISTS p_shares_tenant ON event_groups.shares;
CREATE POLICY p_shares_tenant ON event_groups.shares
  FOR ALL
  USING (
    app_is_platform_admin()
    OR owner_promoter_id = app_current_promoter_id()
    OR shared_with_promoter_id = app_current_promoter_id()
  )
  WITH CHECK (
    -- zápis (vytvoření/změna sdílení) smí jen vlastník skupiny nebo admin —
    -- příjemce si nesmí sám přidat oprávnění
    app_is_platform_admin()
    OR owner_promoter_id = app_current_promoter_id()
  );

-- ── 2. marketing.promo_codes — admin|owner; service (checkout/validate) plný ──
ALTER TABLE marketing.promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS svc_marketing_promo_codes ON marketing.promo_codes;
CREATE POLICY svc_marketing_promo_codes ON marketing.promo_codes
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

DROP POLICY IF EXISTS p_promo_codes_tenant ON marketing.promo_codes;
CREATE POLICY p_promo_codes_tenant ON marketing.promo_codes
  FOR ALL
  USING (app_is_platform_admin() OR created_by_organizer_id = app_current_promoter_id())
  WITH CHECK (app_is_platform_admin() OR created_by_organizer_id = app_current_promoter_id());

-- ── 3. catalog.venue_seating_charts — sdílená reference (read-all, write admin) ─
ALTER TABLE catalog.venue_seating_charts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS svc_catalog_venue_seating_charts ON catalog.venue_seating_charts;
CREATE POLICY svc_catalog_venue_seating_charts ON catalog.venue_seating_charts
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

DROP POLICY IF EXISTS p_venue_seating_charts_admin ON catalog.venue_seating_charts;
CREATE POLICY p_venue_seating_charts_admin ON catalog.venue_seating_charts
  FOR ALL USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

-- Layout sálu není tajný — čte ho promotér (tvorba akce) i veřejný seat-map
-- (api/events/[id]/seats, bez kontextu). Read pro všechny, zápis jen admin/service.
DROP POLICY IF EXISTS p_venue_seating_charts_read ON catalog.venue_seating_charts;
CREATE POLICY p_venue_seating_charts_read ON catalog.venue_seating_charts
  FOR SELECT USING (true);

-- ── 4. catalog.moderation_blocklist — globální config (read-all, write admin) ──
ALTER TABLE catalog.moderation_blocklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS svc_catalog_moderation_blocklist ON catalog.moderation_blocklist;
CREATE POLICY svc_catalog_moderation_blocklist ON catalog.moderation_blocklist
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

DROP POLICY IF EXISTS p_moderation_blocklist_admin ON catalog.moderation_blocklist;
CREATE POLICY p_moderation_blocklist_admin ON catalog.moderation_blocklist
  FOR ALL USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

-- AI moderation gate čte blocklist v promoter kontextu (při tvorbě akce).
-- Keyword blocklist není citlivý → read pro všechny, zápis jen admin/service.
DROP POLICY IF EXISTS p_moderation_blocklist_read ON catalog.moderation_blocklist;
CREATE POLICY p_moderation_blocklist_read ON catalog.moderation_blocklist
  FOR SELECT USING (true);
