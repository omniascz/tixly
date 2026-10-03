-- 481_v8_write_isolation.sql — kolo 2 / V8: RLS na zápis + promo_codes
--
-- Nález V8 (audit e2e_07/07b): politiky FOR ALL s veřejnou čtecí větví a bez WITH CHECK
-- dovolily KOMUKOLI (i bez kontextu, i cizímu promotérovi) přepsat publikovanou akci, ceny
-- a sedadla; marketing.promo_codes RLS neměla vůbec; kupec mohl vložit (zaplacenou)
-- objednávku / položku / vstupenku do akce cizího pořadatele.
--
-- Princip: ČTENÍ beze změny (veřejná větev published zůstává jen pro SELECT),
-- ZÁPIS jen pořadatel vlastnící akci, platform admin a servisní kontext.
-- Kupec smí dál MĚNIT své objednávky a vstupenky (storno, převod, vazba zařízení),
-- ale NE vkládat nové — vznik objednávky/vstupenky je systémová operace (checkout,
-- webhook, issuer) a běží v servisním kontextu.
-- Idempotentní; bez SECURITY DEFINER; RLS zůstává zapnutá.

BEGIN;

-- ───────────── catalog.events ─────────────
DROP POLICY IF EXISTS p_events_promoter_scope ON catalog.events;
DROP POLICY IF EXISTS p_events_read ON catalog.events;
DROP POLICY IF EXISTS p_events_insert ON catalog.events;
DROP POLICY IF EXISTS p_events_update ON catalog.events;
DROP POLICY IF EXISTS p_events_delete ON catalog.events;
CREATE POLICY p_events_read ON catalog.events FOR SELECT
  USING (public.app_is_platform_admin() OR public.app_is_service()
         OR promoter_id = public.app_current_promoter_id() OR status = 'published');
CREATE POLICY p_events_insert ON catalog.events FOR INSERT
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
              OR promoter_id = public.app_current_promoter_id());
CREATE POLICY p_events_update ON catalog.events FOR UPDATE
  USING      (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id());
CREATE POLICY p_events_delete ON catalog.events FOR DELETE
  USING (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id());

-- ───────────── catalog.ticket_types (ceny) ─────────────
DROP POLICY IF EXISTS p_ticket_types_event_scope ON catalog.ticket_types;
DROP POLICY IF EXISTS p_ticket_types_read ON catalog.ticket_types;
DROP POLICY IF EXISTS p_ticket_types_write ON catalog.ticket_types;
CREATE POLICY p_ticket_types_read ON catalog.ticket_types FOR SELECT
  USING (public.app_is_platform_admin() OR public.app_is_service()
         OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = ticket_types.event_id
                     AND (e.promoter_id = public.app_current_promoter_id() OR e.status = 'published')));
CREATE POLICY p_ticket_types_write ON catalog.ticket_types FOR ALL
  USING      (public.app_is_platform_admin() OR public.app_is_service()
              OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = ticket_types.event_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
              OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = ticket_types.event_id AND e.promoter_id = public.app_current_promoter_id()));

-- ───────────── catalog.event_seats ─────────────
DROP POLICY IF EXISTS p_event_seats_event_scope ON catalog.event_seats;
DROP POLICY IF EXISTS p_event_seats_read ON catalog.event_seats;
DROP POLICY IF EXISTS p_event_seats_write ON catalog.event_seats;
CREATE POLICY p_event_seats_read ON catalog.event_seats FOR SELECT
  USING (public.app_is_platform_admin() OR public.app_is_service()
         OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = event_seats.event_id
                     AND (e.promoter_id = public.app_current_promoter_id() OR e.status = 'published')));
CREATE POLICY p_event_seats_write ON catalog.event_seats FOR ALL
  USING      (public.app_is_platform_admin() OR public.app_is_service()
              OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = event_seats.event_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
              OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = event_seats.event_id AND e.promoter_id = public.app_current_promoter_id()));

-- ───────────── marketing.promo_codes (dřív BEZ RLS) ─────────────
ALTER TABLE marketing.promo_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_promo_codes_tenant ON marketing.promo_codes;
CREATE POLICY p_promo_codes_tenant ON marketing.promo_codes FOR ALL
  USING      (public.app_is_platform_admin() OR public.app_is_service() OR created_by_organizer_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service() OR created_by_organizer_id = public.app_current_promoter_id());

-- ───────────── orders.orders ─────────────
DROP POLICY IF EXISTS p_orders_scope ON orders.orders;
DROP POLICY IF EXISTS p_orders_read ON orders.orders;
DROP POLICY IF EXISTS p_orders_insert ON orders.orders;
DROP POLICY IF EXISTS p_orders_update ON orders.orders;
DROP POLICY IF EXISTS p_orders_delete ON orders.orders;
CREATE POLICY p_orders_read ON orders.orders FOR SELECT
  USING (public.app_is_platform_admin() OR public.app_is_service() OR user_id = public.app_current_user_id()
         OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = orders.event_id AND e.promoter_id = public.app_current_promoter_id()));
CREATE POLICY p_orders_insert ON orders.orders FOR INSERT
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
              OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = orders.event_id AND e.promoter_id = public.app_current_promoter_id()));
CREATE POLICY p_orders_update ON orders.orders FOR UPDATE
  USING      (public.app_is_platform_admin() OR public.app_is_service() OR user_id = public.app_current_user_id()
              OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = orders.event_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service() OR user_id = public.app_current_user_id()
              OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = orders.event_id AND e.promoter_id = public.app_current_promoter_id()));
CREATE POLICY p_orders_delete ON orders.orders FOR DELETE
  USING (public.app_is_platform_admin() OR public.app_is_service()
         OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = orders.event_id AND e.promoter_id = public.app_current_promoter_id()));

-- ───────────── orders.order_items ─────────────
DROP POLICY IF EXISTS p_order_items_scope ON orders.order_items;
DROP POLICY IF EXISTS p_order_items_read ON orders.order_items;
DROP POLICY IF EXISTS p_order_items_write ON orders.order_items;
CREATE POLICY p_order_items_read ON orders.order_items FOR SELECT
  USING (public.app_is_platform_admin() OR public.app_is_service()
         OR EXISTS (SELECT 1 FROM orders.orders o WHERE o.id = order_items.order_id
                     AND (o.user_id = public.app_current_user_id()
                          OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = o.event_id AND e.promoter_id = public.app_current_promoter_id()))));
CREATE POLICY p_order_items_write ON orders.order_items FOR ALL
  USING      (public.app_is_platform_admin() OR public.app_is_service()
              OR EXISTS (SELECT 1 FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
                          WHERE o.id = order_items.order_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
              OR EXISTS (SELECT 1 FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
                          WHERE o.id = order_items.order_id AND e.promoter_id = public.app_current_promoter_id()));

-- ───────────── tickets.tickets ─────────────
DROP POLICY IF EXISTS p_tickets_scope ON tickets.tickets;
DROP POLICY IF EXISTS p_tickets_read ON tickets.tickets;
DROP POLICY IF EXISTS p_tickets_insert ON tickets.tickets;
DROP POLICY IF EXISTS p_tickets_update ON tickets.tickets;
DROP POLICY IF EXISTS p_tickets_delete ON tickets.tickets;
CREATE POLICY p_tickets_read ON tickets.tickets FOR SELECT
  USING (public.app_is_platform_admin() OR public.app_is_service() OR owner_id = public.app_current_user_id()
         OR EXISTS (SELECT 1 FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
                     WHERE o.id = tickets.order_id AND e.promoter_id = public.app_current_promoter_id()));
CREATE POLICY p_tickets_insert ON tickets.tickets FOR INSERT
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
              OR EXISTS (SELECT 1 FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
                          WHERE o.id = tickets.order_id AND e.promoter_id = public.app_current_promoter_id()));
CREATE POLICY p_tickets_update ON tickets.tickets FOR UPDATE
  USING      (public.app_is_platform_admin() OR public.app_is_service() OR owner_id = public.app_current_user_id()
              OR EXISTS (SELECT 1 FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
                          WHERE o.id = tickets.order_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service() OR owner_id = public.app_current_user_id()
              OR EXISTS (SELECT 1 FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
                          WHERE o.id = tickets.order_id AND e.promoter_id = public.app_current_promoter_id()));
CREATE POLICY p_tickets_delete ON tickets.tickets FOR DELETE
  USING (public.app_is_platform_admin() OR public.app_is_service()
         OR EXISTS (SELECT 1 FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
                     WHERE o.id = tickets.order_id AND e.promoter_id = public.app_current_promoter_id()));

COMMIT;
