-- 352_rls_ticket_type_access.sql
--
-- RLS Fáze 2 — Tier C: catalog.ticket_type_access (2026-06-08).
--
-- Tabulka mapuje ticket_type → access_level/zone/day (festivalová access matrix).
-- Audit (audit-admin-rls.mjs) ji našel jako RLS-OFF. Čtecí cesty ověřené:
--   • scanner /api/admin/scanner/validate — runAsActivePromoter (promoter kontext)
--   • admin access-matrix editor — runAsPromoter (promoter kontext)
--   • PUBLIC buyer event page [locale]/events/[id]/page.tsx — raw Pool, BEZ kontextu
--     → potřebuje public-read policy (jinak anon vidí 0 = prázdná access sekce)
--
-- 177 řádků celkem, 19 u published akcí (ty musí být veřejně viditelné).
-- Vzor shodný s migr. 350 (flex_pass_settings): ticket_type → event → published.

ALTER TABLE catalog.ticket_type_access ENABLE ROW LEVEL SECURITY;

-- Service (trusted backend) — plný přístup.
DROP POLICY IF EXISTS svc_catalog_ticket_type_access ON catalog.ticket_type_access;
CREATE POLICY svc_catalog_ticket_type_access ON catalog.ticket_type_access
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

-- Tenant — admin nebo promotér, který VLASTNÍ akci (přes ticket_type → event).
-- Pokrývá scanner (runAsActivePromoter) i admin access-matrix editor.
DROP POLICY IF EXISTS p_ticket_type_access_tenant ON catalog.ticket_type_access;
CREATE POLICY p_ticket_type_access_tenant ON catalog.ticket_type_access
  FOR ALL
  USING (
    app_is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id
      WHERE tt.id = ticket_type_access.ticket_type_id
        AND e.promoter_id = app_current_promoter_id()
    )
  )
  WITH CHECK (
    app_is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id
      WHERE tt.id = ticket_type_access.ticket_type_id
        AND e.promoter_id = app_current_promoter_id()
    )
  );

-- Public read — buyer event page (bez kontextu) vidí access matrix jen pro
-- PUBLISHED akce. Zápis dál řídí tenant/service policy.
DROP POLICY IF EXISTS p_ticket_type_access_pub ON catalog.ticket_type_access;
CREATE POLICY p_ticket_type_access_pub ON catalog.ticket_type_access
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id
      WHERE tt.id = ticket_type_access.ticket_type_id AND e.status = 'published'
    )
  );
