-- 354_rls_audit_log.sql
--
-- RLS Fáze 2 — Tier C: audit.audit_log (2026-06-08). Poslední RLS-OFF tabulka.
--
-- Append-only audit trail. Plní se ZE VŠECH kontextů:
--   1) DB trigger `audit_trigger_func` na orders/tickets/resale_listings — je
--      SECURITY DEFINER vlastněný `tixly` (BYPASSRLS) → tyto INSERTy RLS OBCHÁZEJÍ.
--   2) App kód (refund/holds/reset-password/...) z promoter/user/service kontextů.
--
-- Zápis (INSERT) nemůže nic leaknout a immutability triggery (trg_audit_log_no_update/
-- _no_delete) brání změně → INSERT povolen ze všech kontextů (WITH CHECK true).
-- Citlivé je ČTENÍ (old/new hodnoty objednávek/lístků vč. PII) → SELECT scoped.
--
-- Dva čtecí konzumenti (proto dvojí promoter scope):
--   • /api/admin/audit-log (runAsPromoter) — filtruje actor_id ∈ promoter_members
--   • admin/orders/[orderId]/page.tsx (runAsServerPromoter) — record_id = orderId
--     (actor bývá buyer/system → actor-scope by tu nestačil; nutný record-ownership scope)

ALTER TABLE audit.audit_log ENABLE ROW LEVEL SECURITY;

-- Service (cron/webhook/interní) + admin (app_is_service zahrnuje role admin/system).
DROP POLICY IF EXISTS svc_audit_audit_log ON audit.audit_log;
CREATE POLICY svc_audit_audit_log ON audit.audit_log
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

-- Platform admin plný přístup (explicitně).
DROP POLICY IF EXISTS p_audit_log_admin ON audit.audit_log;
CREATE POLICY p_audit_log_admin ON audit.audit_log
  FOR ALL USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

-- Append-only: zápis audit záznamu povolen z jakéhokoli kontextu (promoter/user/anon
-- token). Nelze jím nic odhalit; změnu/smazání blokují immutability triggery.
DROP POLICY IF EXISTS p_audit_log_insert ON audit.audit_log;
CREATE POLICY p_audit_log_insert ON audit.audit_log
  FOR INSERT WITH CHECK (true);

-- Promotér čte audit: (a) akcí svých členů (actor scope) NEBO (b) auditovaných
-- záznamů svých akcí (record-ownership scope — orders/tickets přes event.promoter_id).
DROP POLICY IF EXISTS p_audit_log_promoter_read ON audit.audit_log;
CREATE POLICY p_audit_log_promoter_read ON audit.audit_log
  FOR SELECT USING (
    -- (a) aktér je člen tohoto promotéra
    EXISTS (
      SELECT 1 FROM platform.promoter_members pm
       WHERE pm.user_id = audit_log.actor_id
         AND pm.promoter_id = app_current_promoter_id()
    )
    -- (b) auditovaná objednávka patří k akci promotéra
    OR (
      audit_log.schema_name = 'orders' AND audit_log.table_name = 'orders'
      AND EXISTS (
        SELECT 1 FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
         WHERE o.id::text = audit_log.record_id
           AND e.promoter_id = app_current_promoter_id()
      )
    )
    -- (c) auditovaný lístek patří k akci promotéra
    OR (
      audit_log.schema_name = 'tickets' AND audit_log.table_name = 'tickets'
      AND EXISTS (
        SELECT 1 FROM tickets.tickets tk
          JOIN orders.orders o ON o.id = tk.order_id
          JOIN catalog.events e ON e.id = o.event_id
         WHERE tk.id::text = audit_log.record_id
           AND e.promoter_id = app_current_promoter_id()
      )
    )
  );
