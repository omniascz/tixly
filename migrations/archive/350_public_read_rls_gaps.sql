-- 350_public_read_rls_gaps.sql
--
-- SYSTÉMOVÝ FIX (RLS audit veřejných read cest, 2026-06-04).
--
-- Kontext: report db/security-rls-report.md (2026-06-01) označil, že pod ENFORCED
-- RLS „431 raw new Pool handlerů vrátí 0 řádků = tiché rozbití". Veřejné stránky
-- (landing, /events, detail, /p, /resale, /subscriptions, slots, lottery, cross-pass)
-- čtou desítky catalog/marketing tabulek bez app kontextu → bez public-read policy
-- vidí anonym 0 řádků (projevilo se „Online" u venues, prázdné sekce u multi-day,
-- prázdný resale marketplace atd.).
--
-- Empirický audit (service vs anonym count) našel 10 děr + preventivně pokrýváme
-- i tabulky, co jsou teď prázdné, ale jsou public-display (rozbily by se s daty).
--
-- Princip každé policy: řádek je veřejný, jen pokud patří k PUBLISHED akci
-- (EXISTS) nebo má veřejný flag (active/is_public/status). access_codes ZÁMĚRNĚ
-- NEpouštíme (tajné unlock kódy — validují se v service kontextu v route).
-- Zápis (INSERT/UPDATE/DELETE) dál řídí původní tenant/service policy.

-- ── Vázané na PUBLISHED akci (event_id) ──────────────────────────────────────
DROP POLICY IF EXISTS p_event_days_pub ON catalog.event_days;
CREATE POLICY p_event_days_pub ON catalog.event_days FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = event_days.event_id AND e.status = 'published'));

DROP POLICY IF EXISTS p_event_zones_pub ON catalog.event_zones;
CREATE POLICY p_event_zones_pub ON catalog.event_zones FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = event_zones.event_id AND e.status = 'published'));

DROP POLICY IF EXISTS p_collection_events_pub ON catalog.collection_events;
CREATE POLICY p_collection_events_pub ON catalog.collection_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = collection_events.event_id AND e.status = 'published'));

DROP POLICY IF EXISTS p_cross_pass_events_pub ON catalog.cross_pass_events;
CREATE POLICY p_cross_pass_events_pub ON catalog.cross_pass_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = cross_pass_events.event_id AND e.status = 'published'));

DROP POLICY IF EXISTS p_entry_slots_pub ON catalog.entry_slots;
CREATE POLICY p_entry_slots_pub ON catalog.entry_slots FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = entry_slots.event_id AND e.status = 'published'));

DROP POLICY IF EXISTS p_event_lotteries_pub ON catalog.event_lotteries;
CREATE POLICY p_event_lotteries_pub ON catalog.event_lotteries FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = event_lotteries.event_id AND e.status = 'published'));

DROP POLICY IF EXISTS p_event_custom_fields_pub ON catalog.event_custom_fields;
CREATE POLICY p_event_custom_fields_pub ON catalog.event_custom_fields FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = event_custom_fields.event_id AND e.status = 'published'));

DROP POLICY IF EXISTS p_hospitality_packages_pub ON catalog.hospitality_packages;
CREATE POLICY p_hospitality_packages_pub ON catalog.hospitality_packages FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = hospitality_packages.event_id AND e.status = 'published'));

DROP POLICY IF EXISTS p_event_bundles_pub ON catalog.event_bundles;
CREATE POLICY p_event_bundles_pub ON catalog.event_bundles FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = event_bundles.event_id AND e.status = 'published'));

DROP POLICY IF EXISTS p_package_events_pub ON subscriptions.package_events;
CREATE POLICY p_package_events_pub ON subscriptions.package_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = package_events.event_id AND e.status = 'published'));

DROP POLICY IF EXISTS p_checkout_addons_pub ON public.checkout_addons;
CREATE POLICY p_checkout_addons_pub ON public.checkout_addons FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = checkout_addons.event_id AND e.status = 'published'));

-- ── Přes ticket_type → published akce ────────────────────────────────────────
DROP POLICY IF EXISTS p_flex_pass_settings_pub ON catalog.flex_pass_settings;
CREATE POLICY p_flex_pass_settings_pub ON catalog.flex_pass_settings FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id
          WHERE tt.id = flex_pass_settings.ticket_type_id AND e.status = 'published'));

DROP POLICY IF EXISTS p_ticket_modular_pricing_pub ON catalog.ticket_modular_pricing;
CREATE POLICY p_ticket_modular_pricing_pub ON catalog.ticket_modular_pricing FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id
          WHERE tt.id = ticket_modular_pricing.ticket_type_id AND e.status = 'published'));

DROP POLICY IF EXISTS p_ttcp_pub ON catalog.ticket_type_channel_prices;
CREATE POLICY p_ttcp_pub ON catalog.ticket_type_channel_prices FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id
          WHERE tt.id = ticket_type_channel_prices.ticket_type_id AND e.status = 'published'));

-- ── Přes bundle → published akce ─────────────────────────────────────────────
DROP POLICY IF EXISTS p_event_bundle_addons_pub ON catalog.event_bundle_addons;
CREATE POLICY p_event_bundle_addons_pub ON catalog.event_bundle_addons FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.event_bundles b JOIN catalog.events e ON e.id = b.event_id
          WHERE b.id = event_bundle_addons.bundle_id AND e.status = 'published'));

-- ── Přes seat → published akce ───────────────────────────────────────────────
DROP POLICY IF EXISTS p_seat_view_photos_pub ON catalog.event_seat_view_photos;
CREATE POLICY p_seat_view_photos_pub ON catalog.event_seat_view_photos FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog.event_seats s JOIN catalog.events e ON e.id = s.event_id
          WHERE s.id = event_seat_view_photos.event_seat_id AND e.status = 'published'));

-- ── Flag-based veřejná data ──────────────────────────────────────────────────
DROP POLICY IF EXISTS p_event_collections_pub ON catalog.event_collections;
CREATE POLICY p_event_collections_pub ON catalog.event_collections FOR SELECT USING (is_public = true);

DROP POLICY IF EXISTS p_event_reviews_pub ON marketing.event_reviews;
CREATE POLICY p_event_reviews_pub ON marketing.event_reviews FOR SELECT USING (is_public = true);

DROP POLICY IF EXISTS p_cross_pass_bundles_pub ON catalog.cross_pass_bundles;
CREATE POLICY p_cross_pass_bundles_pub ON catalog.cross_pass_bundles FOR SELECT USING (active = true);

DROP POLICY IF EXISTS p_subscriptions_plans_pub ON subscriptions.plans;
CREATE POLICY p_subscriptions_plans_pub ON subscriptions.plans FOR SELECT USING (active = true);

DROP POLICY IF EXISTS p_insurance_plans_pub ON catalog.insurance_plans;
CREATE POLICY p_insurance_plans_pub ON catalog.insurance_plans FOR SELECT USING (is_active = true);

-- ── Status-based (platné hodnoty z CHECK constraintů) ────────────────────────
DROP POLICY IF EXISTS p_resale_listings_pub ON resale.resale_listings;
CREATE POLICY p_resale_listings_pub ON resale.resale_listings FOR SELECT USING (
  status IN ('active', 'reserved', 'sold'));

DROP POLICY IF EXISTS p_subscriptions_packages_pub ON subscriptions.packages;
CREATE POLICY p_subscriptions_packages_pub ON subscriptions.packages FOR SELECT USING (
  status IN ('on_sale', 'sold_out', 'closed'));

DROP POLICY IF EXISTS p_editorial_articles_pub ON marketing.editorial_articles;
CREATE POLICY p_editorial_articles_pub ON marketing.editorial_articles FOR SELECT USING (
  status = 'published');

-- Status page (/status) — jen veřejně označené incidenty.
DROP POLICY IF EXISTS p_incidents_pub ON platform.incidents;
CREATE POLICY p_incidents_pub ON platform.incidents FOR SELECT USING (is_public = true);
