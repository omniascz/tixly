-- 353_rls_wristband_transactions.sql
--
-- RLS Fáze 2 — Tier C: tickets.wristband_transactions (2026-06-08).
--
-- RFID náramek transakce (topup/charge). Audit (audit-admin-rls.mjs) ji našel jako
-- RLS-OFF. Všechny 3 routes (bind/charge/topup) BĚŽÍ v promoter kontextu
-- (runAsActivePromoter) — codemod netřeba (dřívější audit minul runAsActivePromoter).
--
-- Izolace stejným řetězcem jako tickets.wristbands (p_scope):
--   wristband_uid → tickets.wristbands → tickets.tickets → orders.orders → events.
-- Promotér vidí transakce náramků navázaných na své akce; buyer své (o.user_id).

ALTER TABLE tickets.wristband_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS svc_tickets_wristband_transactions ON tickets.wristband_transactions;
CREATE POLICY svc_tickets_wristband_transactions ON tickets.wristband_transactions
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

-- Čtení: admin / promotér-akce / buyer-vlastník. Zápis (charge/topup/bind běží
-- v promoter kontextu): admin nebo promotér akce.
DROP POLICY IF EXISTS p_wristband_transactions_scope ON tickets.wristband_transactions;
CREATE POLICY p_wristband_transactions_scope ON tickets.wristband_transactions
  FOR ALL
  USING (
    app_is_platform_admin()
    OR EXISTS (
      SELECT 1
        FROM tickets.wristbands w
        JOIN tickets.tickets tk ON tk.id = w.ticket_id
        JOIN orders.orders o ON o.id = tk.order_id
       WHERE w.uid = wristband_transactions.wristband_uid
         AND (
           o.user_id = app_current_user_id()
           OR EXISTS (
             SELECT 1 FROM catalog.events e
              WHERE e.id = o.event_id AND e.promoter_id = app_current_promoter_id()
           )
         )
    )
  )
  WITH CHECK (
    app_is_platform_admin()
    OR EXISTS (
      SELECT 1
        FROM tickets.wristbands w
        JOIN tickets.tickets tk ON tk.id = w.ticket_id
        JOIN orders.orders o ON o.id = tk.order_id
       WHERE w.uid = wristband_transactions.wristband_uid
         AND EXISTS (
           SELECT 1 FROM catalog.events e
            WHERE e.id = o.event_id AND e.promoter_id = app_current_promoter_id()
         )
    )
  );
