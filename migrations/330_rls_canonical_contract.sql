-- RLS Fáze 2, krok 1: KANONICKÝ context kontrakt + sjednocené policy (golden-path slice).
-- (větev feature/rls-phase2-enforcement — NEslučovat do master bez staging validace)
--
-- Sjednocuje 3 dosavadní nekonzistentní konvence na jeden kontrakt:
--   app.current_user_id      → app_current_user_id()      (buyer / vlastník)
--   app.current_promoter_id  → app_current_promoter_id()  (aktivní promotér-tenant)
--   app.is_platform_admin    → app_is_platform_admin()    (master admin)
--   app.role='service'       → app_is_service()           (trusted backend full-access)
--
-- Model přístupu (každá tabulka): platform admin || service || vlastník || promotér akce
--   + veřejné čtení published akcí. Idempotentní (DROP POLICY IF EXISTS + CREATE).

-- ── helpery ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.app_is_service() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.role', true), ''), '') IN ('service', 'admin');
$$;

-- ── catalog.events (rozšířit o service, jinak zachovat ověřené chování) ──
DROP POLICY IF EXISTS p_events_promoter_scope ON catalog.events;
CREATE POLICY p_events_promoter_scope ON catalog.events FOR ALL
  USING (app_is_platform_admin() OR app_is_service()
         OR promoter_id = app_current_promoter_id()
         OR status = 'published');

-- ── catalog.ticket_types (přes event scope + service) ──
DROP POLICY IF EXISTS p_ticket_types_event_scope ON catalog.ticket_types;
CREATE POLICY p_ticket_types_event_scope ON catalog.ticket_types FOR ALL
  USING (app_is_platform_admin() OR app_is_service() OR EXISTS (
    SELECT 1 FROM catalog.events e
    WHERE e.id = ticket_types.event_id
      AND (e.promoter_id = app_current_promoter_id() OR e.status = 'published')));

-- ── catalog.event_seats (NOVĚ: RLS off → on) ──
ALTER TABLE catalog.event_seats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_event_seats_event_scope ON catalog.event_seats;
CREATE POLICY p_event_seats_event_scope ON catalog.event_seats FOR ALL
  USING (app_is_platform_admin() OR app_is_service() OR EXISTS (
    SELECT 1 FROM catalog.events e
    WHERE e.id = event_seats.event_id
      AND (e.promoter_id = app_current_promoter_id() OR e.status = 'published')));

-- ── orders.orders (sjednotit 2 staré policy → 1 kanonickou) ──
DROP POLICY IF EXISTS orders_user_isolation ON orders.orders;
DROP POLICY IF EXISTS orders_service_full_access ON orders.orders;
DROP POLICY IF EXISTS p_orders_scope ON orders.orders;
CREATE POLICY p_orders_scope ON orders.orders FOR ALL
  USING (app_is_platform_admin() OR app_is_service()
         OR user_id = app_current_user_id()
         OR EXISTS (SELECT 1 FROM catalog.events e
                    WHERE e.id = orders.event_id AND e.promoter_id = app_current_promoter_id()));

-- ── orders.order_items (NOVĚ: přes parent order) ──
ALTER TABLE orders.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_order_items_scope ON orders.order_items;
CREATE POLICY p_order_items_scope ON orders.order_items FOR ALL
  USING (app_is_platform_admin() OR app_is_service() OR EXISTS (
    SELECT 1 FROM orders.orders o
    WHERE o.id = order_items.order_id
      AND (o.user_id = app_current_user_id()
           OR EXISTS (SELECT 1 FROM catalog.events e
                      WHERE e.id = o.event_id AND e.promoter_id = app_current_promoter_id()))));

-- ── tickets.tickets (sjednotit: vlastník || promotér akce || admin/service) ──
DROP POLICY IF EXISTS tickets_owner_isolation ON tickets.tickets;
DROP POLICY IF EXISTS tickets_service_full_access ON tickets.tickets;
DROP POLICY IF EXISTS p_tickets_scope ON tickets.tickets;
CREATE POLICY p_tickets_scope ON tickets.tickets FOR ALL
  USING (app_is_platform_admin() OR app_is_service()
         OR owner_id = app_current_user_id()
         OR EXISTS (SELECT 1 FROM orders.orders o
                    JOIN catalog.events e ON e.id = o.event_id
                    WHERE o.id = tickets.order_id
                      AND e.promoter_id = app_current_promoter_id()));
