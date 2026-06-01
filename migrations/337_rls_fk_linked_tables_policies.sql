-- RLS Fáze 2 — policy review vlna 2: 27 RLS-off child tabulek bez přímého tenant
-- sloupce, ale s FK na ticket/order/event. Scoping přes FK řetěz.
--
--   ticket-scoped: ticket → order → (buyer user || event promotér)
--   order-scoped:  order → (buyer user || event promotér)
--   event-scoped:  event → promotér
-- FOR ALL bez WITH CHECK → INSERT check dědí USING. service/admin vždy plný přístup.

-- ============ TICKET-scoped (přes ticket_id) ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accessibility.accommodations','b2b.secure_entry_tokens','flex_plans.flex_plan_selections',
    'marketing.event_reminders','scanner.scanned_tokens','tickets.attendee_info',
    'tickets.attendee_info_log','tickets.device_binding_log','tickets.nfc_taps',
    'tickets.pass_updates_log','tickets.scans','tickets.ticket_changes',
    'tickets.ticket_modular_access','tickets.ticket_picks','tickets.ticket_redemptions',
    'tickets.ticket_transfers','tickets.transfer_invitations','tickets.wallet_push_jobs',
    'tickets.wallet_push_subscriptions','tickets.wristbands','turnstiles.turnstile_passages',
    'public.ticket_installments'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS p_scope ON %s', t);
    EXECUTE format($f$
      CREATE POLICY p_scope ON %1$s FOR ALL USING (
        app_is_service() OR app_is_platform_admin()
        OR EXISTS (
          SELECT 1 FROM tickets.tickets tk
          JOIN orders.orders o ON o.id = tk.order_id
          WHERE tk.id = %1$s.ticket_id
            AND ( o.user_id = app_current_user_id()
                  OR EXISTS (SELECT 1 FROM catalog.events e
                              WHERE e.id = o.event_id AND e.promoter_id = app_current_promoter_id()) )
        )
      )$f$, t);
  END LOOP;
END $$;

-- ============ ORDER-scoped (přes order_id) ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'public.order_addons','public.order_packages','public.permanentky_reservations'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS p_scope ON %s', t);
    EXECUTE format($f$
      CREATE POLICY p_scope ON %1$s FOR ALL USING (
        app_is_service() OR app_is_platform_admin()
        OR EXISTS (
          SELECT 1 FROM orders.orders o
          WHERE o.id = %1$s.order_id
            AND ( o.user_id = app_current_user_id()
                  OR EXISTS (SELECT 1 FROM catalog.events e
                              WHERE e.id = o.event_id AND e.promoter_id = app_current_promoter_id()) )
        )
      )$f$, t);
  END LOOP;
END $$;

-- ============ EVENT-scoped (přes event_id, jen promotér) ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit.event_moderation_log','public.bot_proof_queue'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS p_scope ON %s', t);
    EXECUTE format($f$
      CREATE POLICY p_scope ON %1$s FOR ALL USING (
        app_is_service() OR app_is_platform_admin()
        OR EXISTS (SELECT 1 FROM catalog.events e
                    WHERE e.id = %1$s.event_id AND e.promoter_id = app_current_promoter_id())
      )$f$, t);
  END LOOP;
END $$;
