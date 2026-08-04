--
-- 455_rls_namedrift_identity.sql — name-drift GUC → kanonické app_*() helpery
--
-- Policies čtou GUC jména, která `rls-pool.ts` NIKDY nenastavuje (FINDINGS §38).
-- Predikát se proto nemůže stát pravdivým a policy jen odepírá — 6 z 12 tabulek,
-- kde aplikace nevidí ani vlastní data, sedí přesně na tenhle rozpor (§34).
--
-- Převádí se JEN jména IDENTITY:
--   app.promoter_id → public.app_current_promoter_id()
--   app.user_id     → public.app_current_user_id()
--
-- ⚠️ NEPŘEVÁDÍ se `app.bypass_rls`, `app.use_service_role`, `app.is_service`,
--    `app.is_admin`, `app.platform_admin`. To jsou příznaky ZVÝŠENÍ OPRÁVNĚNÍ,
--    ne identity. Dnes jsou mrtvé; napojit je na app_is_service() /
--    app_is_platform_admin() by AKTIVOVALO dosud mrtvou větev, tedy rozšířilo
--    přístup. Jiné rozhodnutí, jiná migrace, vlastní měření.
--
-- Rozdíl je v ohraničení: jméno identity vrací přístup k VLASTNÍM datům
-- (omezeno tenantem), příznak oprávnění dává plošný bypass.
--
-- Helpery navíc dělají NULLIF(current_setting(…),'')::uuid, takže tahle
-- migrace zároveň odstraňuje přímé casty → past 22P02 (§39).
--
-- Vygenerováno scripts/gen-455-namedrift.mjs — 20 policies.
--
-- NENASAZENO NA PRODUKCI.
--

BEGIN;

-- ── catalog.event_distribution_partners :: edp_promoter_delete ──
DROP POLICY IF EXISTS "edp_promoter_delete" ON "catalog"."event_distribution_partners";
CREATE POLICY "edp_promoter_delete" ON "catalog"."event_distribution_partners" FOR DELETE
  USING ((event_id IN ( SELECT events.id
   FROM catalog.events
  WHERE (events.promoter_id = public.app_current_promoter_id()))));

-- ── catalog.event_distribution_partners :: edp_promoter_insert ──
DROP POLICY IF EXISTS "edp_promoter_insert" ON "catalog"."event_distribution_partners";
CREATE POLICY "edp_promoter_insert" ON "catalog"."event_distribution_partners" FOR INSERT
  WITH CHECK ((event_id IN ( SELECT events.id
   FROM catalog.events
  WHERE (events.promoter_id = public.app_current_promoter_id()))));

-- ── catalog.event_distribution_partners :: edp_promoter_select ──
DROP POLICY IF EXISTS "edp_promoter_select" ON "catalog"."event_distribution_partners";
CREATE POLICY "edp_promoter_select" ON "catalog"."event_distribution_partners" FOR SELECT
  USING ((event_id IN ( SELECT events.id
   FROM catalog.events
  WHERE (events.promoter_id = public.app_current_promoter_id()))));

-- ── catalog.event_distribution_partners :: edp_promoter_update ──
DROP POLICY IF EXISTS "edp_promoter_update" ON "catalog"."event_distribution_partners";
CREATE POLICY "edp_promoter_update" ON "catalog"."event_distribution_partners" FOR UPDATE
  USING ((event_id IN ( SELECT events.id
   FROM catalog.events
  WHERE (events.promoter_id = public.app_current_promoter_id()))));

-- ── catalog.event_sponsors :: promoter_own_event_sponsors ──
DROP POLICY IF EXISTS "promoter_own_event_sponsors" ON "catalog"."event_sponsors";
CREATE POLICY "promoter_own_event_sponsors" ON "catalog"."event_sponsors"
  USING ((event_id IN ( SELECT events.id
   FROM catalog.events
  WHERE (events.promoter_id = public.app_current_promoter_id()))));

-- ── catalog.event_travel_links :: promoter_own_event_travel_links ──
DROP POLICY IF EXISTS "promoter_own_event_travel_links" ON "catalog"."event_travel_links";
CREATE POLICY "promoter_own_event_travel_links" ON "catalog"."event_travel_links"
  USING ((event_id IN ( SELECT events.id
   FROM catalog.events
  WHERE (events.promoter_id = public.app_current_promoter_id()))));

-- ── catalog.event_travel_packages :: event_travel_packages_write ──
DROP POLICY IF EXISTS "event_travel_packages_write" ON "catalog"."event_travel_packages";
CREATE POLICY "event_travel_packages_write" ON "catalog"."event_travel_packages"
  USING (((current_setting('app.is_platform_admin'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM (catalog.events e
     JOIN platform.promoter_members pm ON ((pm.promoter_id = e.promoter_id)))
  WHERE ((e.id = event_travel_packages.event_id) AND ((pm.user_id)::text = (public.app_current_user_id())::text))))));

-- ── catalog.venue_gates :: venue_gates_select ──
DROP POLICY IF EXISTS "venue_gates_select" ON "catalog"."venue_gates";
CREATE POLICY "venue_gates_select" ON "catalog"."venue_gates" FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM catalog.venues v
  WHERE ((v.id = venue_gates.venue_id) AND (((public.app_current_promoter_id())::text = (v.promoter_id)::text) OR (current_setting('app.is_platform_admin'::text, true) = 'true'::text) OR (current_setting('app.is_service'::text, true) = 'true'::text))))));

-- ── identity.magic_link_tokens :: magic_link_tokens_owner ──
DROP POLICY IF EXISTS "magic_link_tokens_owner" ON "identity"."magic_link_tokens";
CREATE POLICY "magic_link_tokens_owner" ON "identity"."magic_link_tokens"
  USING (((user_id)::text = (public.app_current_user_id())::text));

-- ── lineups.performance_cast :: perf_cast_promoter ──
DROP POLICY IF EXISTS "perf_cast_promoter" ON "lineups"."performance_cast";
CREATE POLICY "perf_cast_promoter" ON "lineups"."performance_cast"
  USING ((event_id IN ( SELECT e.id
   FROM (catalog.events e
     JOIN platform.promoters p ON ((p.id = e.promoter_id)))
  WHERE (p.id = public.app_current_promoter_id()))));

-- ── marketing.ticket_alerts :: ticket_alerts_select ──
DROP POLICY IF EXISTS "ticket_alerts_select" ON "marketing"."ticket_alerts";
CREATE POLICY "ticket_alerts_select" ON "marketing"."ticket_alerts" FOR SELECT
  USING (((current_setting('app.is_platform_admin'::text, true) = 'true'::text) OR ((user_id IS NOT NULL) AND ((user_id)::text = (public.app_current_user_id())::text)) OR ((public.app_current_user_id())::text = ''::text)));

-- ── orders.box_office_sales :: box_office_sales_promoter ──
DROP POLICY IF EXISTS "box_office_sales_promoter" ON "orders"."box_office_sales";
CREATE POLICY "box_office_sales_promoter" ON "orders"."box_office_sales"
  USING (((current_setting('app.is_platform_admin'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM ((orders.box_office_sessions s
     JOIN catalog.events e ON ((e.id = s.event_id)))
     JOIN platform.promoter_members pm ON ((pm.promoter_id = e.promoter_id)))
  WHERE ((s.id = box_office_sales.session_id) AND ((pm.user_id)::text = (public.app_current_user_id())::text))))));

-- ── orders.box_office_sessions :: box_office_sessions_promoter ──
DROP POLICY IF EXISTS "box_office_sessions_promoter" ON "orders"."box_office_sessions";
CREATE POLICY "box_office_sessions_promoter" ON "orders"."box_office_sessions"
  USING (((current_setting('app.is_platform_admin'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM (catalog.events e
     JOIN platform.promoter_members pm ON ((pm.promoter_id = e.promoter_id)))
  WHERE ((e.id = box_office_sessions.event_id) AND ((pm.user_id)::text = (public.app_current_user_id())::text))))));

-- ── orders.postal_deliveries :: postal_deliveries_buyer ──
DROP POLICY IF EXISTS "postal_deliveries_buyer" ON "orders"."postal_deliveries";
CREATE POLICY "postal_deliveries_buyer" ON "orders"."postal_deliveries" FOR SELECT
  USING (((current_setting('app.is_platform_admin'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM orders.orders o
  WHERE ((o.id = postal_deliveries.order_id) AND ((o.user_id)::text = (public.app_current_user_id())::text))))));

-- ── orders.seat_upgrades :: seat_upgrades_buyer ──
DROP POLICY IF EXISTS "seat_upgrades_buyer" ON "orders"."seat_upgrades";
CREATE POLICY "seat_upgrades_buyer" ON "orders"."seat_upgrades" FOR SELECT
  USING (((current_setting('app.is_platform_admin'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM orders.orders o
  WHERE ((o.id = seat_upgrades.original_order_id) AND ((o.user_id)::text = (public.app_current_user_id())::text))))));

-- ── orders.ticket_transfers :: ticket_transfers_insert ──
DROP POLICY IF EXISTS "ticket_transfers_insert" ON "orders"."ticket_transfers";
CREATE POLICY "ticket_transfers_insert" ON "orders"."ticket_transfers" FOR INSERT
  WITH CHECK (((from_user_id)::text = (public.app_current_user_id())::text));

-- ── orders.ticket_transfers :: ticket_transfers_sender ──
DROP POLICY IF EXISTS "ticket_transfers_sender" ON "orders"."ticket_transfers";
CREATE POLICY "ticket_transfers_sender" ON "orders"."ticket_transfers" FOR SELECT
  USING ((((from_user_id)::text = (public.app_current_user_id())::text) OR (current_setting('app.is_platform_admin'::text, true) = 'true'::text)));

-- ── orders.travel_bookings :: travel_bookings_select ──
DROP POLICY IF EXISTS "travel_bookings_select" ON "orders"."travel_bookings";
CREATE POLICY "travel_bookings_select" ON "orders"."travel_bookings" FOR SELECT
  USING (((current_setting('app.is_platform_admin'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM orders.orders o
  WHERE ((o.id = travel_bookings.order_id) AND ((o.user_id)::text = (public.app_current_user_id())::text))))));

-- ── payments.wero_payments :: wero_payments_tenant_isolation ──
DROP POLICY IF EXISTS "wero_payments_tenant_isolation" ON "payments"."wero_payments";
CREATE POLICY "wero_payments_tenant_isolation" ON "payments"."wero_payments" FOR SELECT
  USING (((promoter_id = (public.app_current_promoter_id())::text) OR (current_setting('app.is_admin'::text, true))::boolean));

-- ── payments.wero_webhooks :: wero_webhooks_tenant_isolation ──
DROP POLICY IF EXISTS "wero_webhooks_tenant_isolation" ON "payments"."wero_webhooks";
CREATE POLICY "wero_webhooks_tenant_isolation" ON "payments"."wero_webhooks" FOR SELECT
  USING ((payment_id IN ( SELECT wero_payments.id
   FROM payments.wero_payments
  WHERE ((wero_payments.promoter_id = (public.app_current_promoter_id())::text) OR (current_setting('app.is_admin'::text, true))::boolean))));

COMMIT;
