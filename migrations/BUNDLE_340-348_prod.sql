-- BUNDLE migrací 340-348 pro produkci (Tixly deep-E2E session 2026-06-03)
-- Aplikovat jako Neon owner (neondb_owner). Idempotentní (DROP POLICY IF EXISTS / ADD CONSTRAINT IF EXISTS).
BEGIN;

-- ===== migrations/340_promoters_id_default.sql =====
-- 340_promoters_id_default.sql
--
-- BUG FIX: platform.promoters.id byl `uuid NOT NULL` BEZ defaultu, zatímco
-- všechny ostatní tabulky mají `DEFAULT gen_random_uuid()`. Existující
-- promotéři byli naseedováni s explicitním id, takže to nikdy nepropuklo —
-- ale self-registrace promotéra (POST /api/auth/register-promoter) INSERTuje
-- bez id a spoléhá na default → padala na NOT NULL (HTTP 500) v dev I produkci.
--
-- Sjednocuje chování s identity.users.id a zbytkem schématu.

ALTER TABLE platform.promoters ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- ===== migrations/341_rls_service_role_consistency.sql =====
-- 341_rls_service_role_consistency.sql
--
-- BUG FIX (RLS Fáze 2 drift): 12 policies hardcodovalo
--   current_setting('app.role') = ANY(ARRAY['service','admin'])
-- což VYNECHÁVÁ 'system' — jenže runWithServiceContext() nastavuje app.role='system'
-- (validní audit_log.actor_type). Důsledek: service-context zápisy/čtení do těchto
-- tabulek padaly na RLS (resale list → 500, a latentně loyalty, gift/ticket transfer,
-- verified_fan, payouts). Kanonický helper je app_is_service() = role IN
-- ('service','admin','system') — sjednocujeme na něj.
--
-- Navíc 6 platform.* promoter policies kontrolovalo `promoter_id = app.tenant_id`,
-- ale rls-pool nastavuje app.current_promoter_id (NE app.tenant_id) → promotér by
-- své výplaty/settlementy neviděl. Opravujeme na app_current_promoter_id().
--
-- app_is_service() dáváme v OR jako PRVNÍ — short-circuit, aby se v service kontextu
-- nevyhodnocoval druhý operand (a nepadal na prázdném uuid castu).

-- ── Pure service-access policies (FOR ALL) ───────────────────────────────────
DROP POLICY IF EXISTS loyalty_accounts_service ON loyalty.accounts;
CREATE POLICY loyalty_accounts_service ON loyalty.accounts
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

DROP POLICY IF EXISTS loyalty_tx_service ON loyalty.transactions;
CREATE POLICY loyalty_tx_service ON loyalty.transactions
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

DROP POLICY IF EXISTS resale_listings_service_full_access ON resale.resale_listings;
CREATE POLICY resale_listings_service_full_access ON resale.resale_listings
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

DROP POLICY IF EXISTS gift_transfer_log_service_access ON tickets.gift_transfer_log;
CREATE POLICY gift_transfer_log_service_access ON tickets.gift_transfer_log
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

DROP POLICY IF EXISTS transfer_log_service_access ON tickets.ticket_transfer_log;
CREATE POLICY transfer_log_service_access ON tickets.ticket_transfer_log
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

DROP POLICY IF EXISTS vf_registrations_service ON verified_fan.registrations;
CREATE POLICY vf_registrations_service ON verified_fan.registrations
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

-- ── Promoter read policies (FOR SELECT) — service first + správný promoter id ─
DROP POLICY IF EXISTS platform_event_settlements_promoter ON platform.event_settlements;
CREATE POLICY platform_event_settlements_promoter ON platform.event_settlements
  FOR SELECT USING (app_is_service() OR promoter_id = app_current_promoter_id());

DROP POLICY IF EXISTS platform_fee_schedules_promoter ON platform.fee_schedules;
CREATE POLICY platform_fee_schedules_promoter ON platform.fee_schedules
  FOR SELECT USING (app_is_service() OR promoter_id = app_current_promoter_id());

DROP POLICY IF EXISTS platform_payout_settings_promoter ON platform.payout_settings;
CREATE POLICY platform_payout_settings_promoter ON platform.payout_settings
  FOR SELECT USING (app_is_service() OR promoter_id = app_current_promoter_id());

DROP POLICY IF EXISTS platform_payouts_promoter ON platform.payouts;
CREATE POLICY platform_payouts_promoter ON platform.payouts
  FOR SELECT USING (app_is_service() OR promoter_id = app_current_promoter_id());

DROP POLICY IF EXISTS platform_rolling_reserves_promoter ON platform.rolling_reserves;
CREATE POLICY platform_rolling_reserves_promoter ON platform.rolling_reserves
  FOR SELECT USING (app_is_service() OR promoter_id = app_current_promoter_id());

DROP POLICY IF EXISTS platform_payout_events_promoter ON platform.payout_events;
CREATE POLICY platform_payout_events_promoter ON platform.payout_events
  FOR SELECT USING (
    app_is_service()
    OR payout_id IN (SELECT id FROM platform.payouts WHERE promoter_id = app_current_promoter_id())
  );

-- ===== migrations/342_audit_actor_type_promoter.sql =====
-- 342_audit_actor_type_promoter.sql
--
-- BUG FIX: runWithPromoterContext() nenastavoval app.role → audit trigger na
-- UPDATE orders/tickets (a dalších) zapisoval actor_type = '' (prázdný string),
-- což poruší audit_log_actor_type_check → KAŽDÁ promotér-context operace, která
-- spustí audit trigger (refund, atd.), padala na HTTP 500.
--
-- Promotér je legitimní typ aktéra — přidáváme 'promoter' do povolených hodnot
-- (vedle code fixu, který runWithPromoterContext nastaví app.role='promoter').
-- Tím jsou akce promotérů v audit logu DISTINKTNĚ dohledatelné (kdo refundoval).

ALTER TABLE audit.audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_type_check;
ALTER TABLE audit.audit_log ADD CONSTRAINT audit_log_actor_type_check
  CHECK (actor_type = ANY (ARRAY['user','system','admin','platform_admin','gate','promoter']));

-- ===== migrations/343_rls_safe_uuid_casts.sql =====
-- 343_rls_safe_uuid_casts.sql
--
-- BUG FIX (systémový, flaky): 10 RLS policies castovalo session GUC napřímo —
--   (current_setting('app.current_user_id', true))::uuid
-- Jenže RlsAwarePool.connect() na release dělá RESET app.current_user_id, což
-- u custom (placeholder) GUC nechá PRÁZDNÝ ŘETĚZEC '' (ne NULL). Recyklovaná
-- connection z poolu pak při vyhodnocení policy spustí ''::uuid →
-- "invalid input syntax for type uuid". Flaky 500 podle toho, jaká connection
-- z poolu request obslouží (proto resale list jednou prošel, podruhé spadl).
--
-- Oprava: použít bezpečné helpery app_current_user_id() / app_current_promoter_id(),
-- které dělají NULLIF(current_setting(...), '')::uuid → '' se chová jako NULL.
-- Veškerá ostatní logika policies zachována 1:1.

-- ── FOR ALL ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS fb_publishes_promoter_isolation ON catalog.event_fb_publishes;
CREATE POLICY fb_publishes_promoter_isolation ON catalog.event_fb_publishes
  FOR ALL USING (
    event_id IN (
      SELECT e.id FROM catalog.events e
      JOIN platform.promoter_members pm ON pm.promoter_id = e.promoter_id
      WHERE pm.user_id = app_current_user_id()
    ) OR current_setting('app.platform_admin', true) = 'true'
  );

DROP POLICY IF EXISTS ticket_content_promoter ON ignite.ticket_content;
CREATE POLICY ticket_content_promoter ON ignite.ticket_content
  FOR ALL USING (promoter_id = app_current_promoter_id());

DROP POLICY IF EXISTS loyalty_accounts_user ON loyalty.accounts;
CREATE POLICY loyalty_accounts_user ON loyalty.accounts
  FOR ALL USING (user_id = app_current_user_id());

DROP POLICY IF EXISTS fb_pages_promoter_isolation ON marketing.facebook_pages;
CREATE POLICY fb_pages_promoter_isolation ON marketing.facebook_pages
  FOR ALL USING (
    promoter_id IN (
      SELECT promoter_id FROM platform.promoter_members
      WHERE user_id = app_current_user_id()
    ) OR current_setting('app.platform_admin', true) = 'true'
  );

DROP POLICY IF EXISTS qr_campaigns_promoter_isolation ON marketing.qr_campaigns;
CREATE POLICY qr_campaigns_promoter_isolation ON marketing.qr_campaigns
  FOR ALL USING (
    event_id IN (
      SELECT e.id FROM catalog.events e
      JOIN platform.promoter_members pm ON pm.promoter_id = e.promoter_id
      WHERE pm.user_id = app_current_user_id()
    ) OR current_setting('app.platform_admin', true) = 'true'
  );

DROP POLICY IF EXISTS transit_passes_buyer_owns ON orders.transit_passes;
CREATE POLICY transit_passes_buyer_owns ON orders.transit_passes
  FOR ALL USING (
    order_id IN (
      SELECT id FROM orders.orders WHERE user_id = app_current_user_id()
    ) OR current_setting('app.platform_admin', true) = 'true'
  );

DROP POLICY IF EXISTS resale_listings_seller_modify ON resale.resale_listings;
CREATE POLICY resale_listings_seller_modify ON resale.resale_listings
  FOR ALL USING (seller_id = app_current_user_id());

-- ── FOR SELECT ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS loyalty_tx_user ON loyalty.transactions;
CREATE POLICY loyalty_tx_user ON loyalty.transactions
  FOR SELECT USING (user_id = app_current_user_id());

DROP POLICY IF EXISTS resale_listings_buyer_view ON resale.resale_listings;
CREATE POLICY resale_listings_buyer_view ON resale.resale_listings
  FOR SELECT USING (
    status = 'active'
    OR seller_id = app_current_user_id()
    OR buyer_id = app_current_user_id()
  );

DROP POLICY IF EXISTS vf_registrations_user ON verified_fan.registrations;
CREATE POLICY vf_registrations_user ON verified_fan.registrations
  FOR SELECT USING (user_id = app_current_user_id());

-- ===== migrations/344_users_promoter_insert.sql =====
-- 344_users_promoter_insert.sql
--
-- BUG FIX: POS prodej (walk-in pokladna) běží v promotér kontextu a vytváří
-- anonymního walk-in kupce v identity.users. Jenže p_users_write WITH CHECK
-- povolí INSERT jen service/platform-admin/self → promotér ho nevloží → RLS
-- violation → POS sale HTTP 500.
--
-- Promotér vytvářející walk-in zákazníka u kasy je legitimní operace. Přidáváme
-- INSERT-ONLY policy pro promotér kontext (negranuje UPDATE/DELETE cizích userů).
-- Read na identity.users už je beztak USING true (žádná row-privacy na úrovni tabulky).

CREATE POLICY p_users_promoter_insert ON identity.users
  FOR INSERT WITH CHECK (app_current_promoter_id() IS NOT NULL);

-- ===== migrations/345_orders_payment_provider_free.sql =====
-- 345_orders_payment_provider_free.sql
--
-- BUG FIX: POS prodej (walk-in pokladna) vytváří order s payment_provider='free'
-- (peníze inkasuje promotér u kasy, žádná online brána). Jenže
-- orders_payment_provider_check 'free' nepovolí → POS sale HTTP 500.
--
-- Přidáváme 'free' (offline/manuální kanál) do povolených hodnot.

ALTER TABLE orders.orders DROP CONSTRAINT IF EXISTS orders_payment_provider_check;
ALTER TABLE orders.orders ADD CONSTRAINT orders_payment_provider_check
  CHECK (payment_provider = ANY (ARRAY[
    'mock','gopay','comgate','stripe','wero','przelewy24','bank_transfer',
    'twisto','skippay','pluxee','sodexo','benefit_plus','edenred',
    'voucher','charity','free'
  ]));

-- ===== migrations/346_rls_service_bypass_tenant_tables.sql =====
-- 346_rls_service_bypass_tenant_tables.sql
--
-- BUG FIX (systémový): 127 tenant policies mělo promotér-izolaci
-- (promoter_id = app_current_promoter_id()) ale CHYBĚL app_is_service() →
-- jakýkoli service-context flow (checkout voucher redeem, /subscriptions/subscribe,
-- crony, public endpointy) tyto tabulky NEVIDĚL → 422/prázdné výsledky.
-- Potvrzeno: subscriptions.plans (PLAN_NOT_AVAILABLE), gift_vouchers (VOUCHER_INVALID).
--
-- Fix: ke každé tabulce přidat ADITIVNÍ service-bypass policy (permissive, OR).
-- Nehrabe do existující promotér-izolace; app_is_service() je true jen pro
-- trusted backend (role service/system/admin).

DROP POLICY IF EXISTS svc_accessibility_accessible_seats ON accessibility.accessible_seats;
CREATE POLICY svc_accessibility_accessible_seats ON accessibility.accessible_seats FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_accreditation_accreditation_requests ON accreditation.accreditation_requests;
CREATE POLICY svc_accreditation_accreditation_requests ON accreditation.accreditation_requests FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_ads_dynamic_creative_templates ON ads.dynamic_creative_templates;
CREATE POLICY svc_ads_dynamic_creative_templates ON ads.dynamic_creative_templates FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_affiliate_affiliates ON affiliate.affiliates;
CREATE POLICY svc_affiliate_affiliates ON affiliate.affiliates FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_ai_ads_generated_ad_copies ON ai_ads.generated_ad_copies;
CREATE POLICY svc_ai_ads_generated_ad_copies ON ai_ads.generated_ad_copies FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_ambassador_ambassadors ON ambassador.ambassadors;
CREATE POLICY svc_ambassador_ambassadors ON ambassador.ambassadors FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_audit_anomaly_alerts ON audit.anomaly_alerts;
CREATE POLICY svc_audit_anomaly_alerts ON audit.anomaly_alerts FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_audit_content_reports ON audit.content_reports;
CREATE POLICY svc_audit_content_reports ON audit.content_reports FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_audit_platform_log ON audit.platform_log;
CREATE POLICY svc_audit_platform_log ON audit.platform_log FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_b2b_api_keys ON b2b.api_keys;
CREATE POLICY svc_b2b_api_keys ON b2b.api_keys FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_b2b_oauth_access_tokens ON b2b.oauth_access_tokens;
CREATE POLICY svc_b2b_oauth_access_tokens ON b2b.oauth_access_tokens FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_b2b_oauth_authorization_codes ON b2b.oauth_authorization_codes;
CREATE POLICY svc_b2b_oauth_authorization_codes ON b2b.oauth_authorization_codes FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_b2b_oauth_refresh_tokens ON b2b.oauth_refresh_tokens;
CREATE POLICY svc_b2b_oauth_refresh_tokens ON b2b.oauth_refresh_tokens FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_b2b_orders_invoice_orders ON b2b_orders.invoice_orders;
CREATE POLICY svc_b2b_orders_invoice_orders ON b2b_orders.invoice_orders FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_blacklist_blacklist_entries ON blacklist.blacklist_entries;
CREATE POLICY svc_blacklist_blacklist_entries ON blacklist.blacklist_entries FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_catalog_access_codes ON catalog.access_codes;
CREATE POLICY svc_catalog_access_codes ON catalog.access_codes FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_catalog_cross_pass_bundles ON catalog.cross_pass_bundles;
CREATE POLICY svc_catalog_cross_pass_bundles ON catalog.cross_pass_bundles FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_catalog_donation_campaigns ON catalog.donation_campaigns;
CREATE POLICY svc_catalog_donation_campaigns ON catalog.donation_campaigns FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_catalog_event_collections ON catalog.event_collections;
CREATE POLICY svc_catalog_event_collections ON catalog.event_collections FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_catalog_event_seat_view_photos ON catalog.event_seat_view_photos;
CREATE POLICY svc_catalog_event_seat_view_photos ON catalog.event_seat_view_photos FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_catalog_event_templates ON catalog.event_templates;
CREATE POLICY svc_catalog_event_templates ON catalog.event_templates FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_catalog_event_ticket_defaults ON catalog.event_ticket_defaults;
CREATE POLICY svc_catalog_event_ticket_defaults ON catalog.event_ticket_defaults FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_catalog_insurance_plans ON catalog.insurance_plans;
CREATE POLICY svc_catalog_insurance_plans ON catalog.insurance_plans FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_catalog_payment_plans ON catalog.payment_plans;
CREATE POLICY svc_catalog_payment_plans ON catalog.payment_plans FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_catalog_sales_channels ON catalog.sales_channels;
CREATE POLICY svc_catalog_sales_channels ON catalog.sales_channels FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_catalog_venues ON catalog.venues;
CREATE POLICY svc_catalog_venues ON catalog.venues FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_channels_event_channel_allocations ON channels.event_channel_allocations;
CREATE POLICY svc_channels_event_channel_allocations ON channels.event_channel_allocations FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_checkout_custom_questions ON checkout.custom_questions;
CREATE POLICY svc_checkout_custom_questions ON checkout.custom_questions FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_comms_fan_communication_templates ON comms.fan_communication_templates;
CREATE POLICY svc_comms_fan_communication_templates ON comms.fan_communication_templates FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_conference_exhibitors ON conference.exhibitors;
CREATE POLICY svc_conference_exhibitors ON conference.exhibitors FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_conference_speakers ON conference.speakers;
CREATE POLICY svc_conference_speakers ON conference.speakers FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_cross_scanner_guest_lists ON cross_scanner.guest_lists;
CREATE POLICY svc_cross_scanner_guest_lists ON cross_scanner.guest_lists FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_event_groups_groups ON event_groups.groups;
CREATE POLICY svc_event_groups_groups ON event_groups.groups FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_eventim_export_export_jobs ON eventim_export.export_jobs;
CREATE POLICY svc_eventim_export_export_jobs ON eventim_export.export_jobs FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_fan_share_campaigns ON fan_share.campaigns;
CREATE POLICY svc_fan_share_campaigns ON fan_share.campaigns FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_flex_plans_flex_catalogs ON flex_plans.flex_catalogs;
CREATE POLICY svc_flex_plans_flex_catalogs ON flex_plans.flex_catalogs FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_flex_plans_flex_plans ON flex_plans.flex_plans;
CREATE POLICY svc_flex_plans_flex_plans ON flex_plans.flex_plans FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_ignite_ticket_content ON ignite.ticket_content;
CREATE POLICY svc_ignite_ticket_content ON ignite.ticket_content FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_lineups_artists ON lineups.artists;
CREATE POLICY svc_lineups_artists ON lineups.artists FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_marketing_ad_campaigns ON marketing.ad_campaigns;
CREATE POLICY svc_marketing_ad_campaigns ON marketing.ad_campaigns FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_marketing_affiliates ON marketing.affiliates;
CREATE POLICY svc_marketing_affiliates ON marketing.affiliates FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_marketing_campaigns ON marketing.campaigns;
CREATE POLICY svc_marketing_campaigns ON marketing.campaigns FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_marketing_event_broadcasts ON marketing.event_broadcasts;
CREATE POLICY svc_marketing_event_broadcasts ON marketing.event_broadcasts FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_marketing_gift_vouchers ON marketing.gift_vouchers;
CREATE POLICY svc_marketing_gift_vouchers ON marketing.gift_vouchers FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_marketing_newsletter_subscribers ON marketing.newsletter_subscribers;
CREATE POLICY svc_marketing_newsletter_subscribers ON marketing.newsletter_subscribers FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_marketing_sms_campaigns ON marketing.sms_campaigns;
CREATE POLICY svc_marketing_sms_campaigns ON marketing.sms_campaigns FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_marketing_support_faq ON marketing.support_faq;
CREATE POLICY svc_marketing_support_faq ON marketing.support_faq FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_marketing_tracking_pixels ON marketing.tracking_pixels;
CREATE POLICY svc_marketing_tracking_pixels ON marketing.tracking_pixels FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_notifications_daily_stats_log ON notifications.daily_stats_log;
CREATE POLICY svc_notifications_daily_stats_log ON notifications.daily_stats_log FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_notifications_daily_stats_subscriptions ON notifications.daily_stats_subscriptions;
CREATE POLICY svc_notifications_daily_stats_subscriptions ON notifications.daily_stats_subscriptions FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_notifications_promoter_notifications ON notifications.promoter_notifications;
CREATE POLICY svc_notifications_promoter_notifications ON notifications.promoter_notifications FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_orders_bank_transfer_imports ON orders.bank_transfer_imports;
CREATE POLICY svc_orders_bank_transfer_imports ON orders.bank_transfer_imports FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_orders_bank_transfer_lines ON orders.bank_transfer_lines;
CREATE POLICY svc_orders_bank_transfer_lines ON orders.bank_transfer_lines FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_orders_chargebacks ON orders.chargebacks;
CREATE POLICY svc_orders_chargebacks ON orders.chargebacks FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_orders_invoices ON orders.invoices;
CREATE POLICY svc_orders_invoices ON orders.invoices FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_orders_refund_requests ON orders.refund_requests;
CREATE POLICY svc_orders_refund_requests ON orders.refund_requests FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_platform_advance_payout_schedules ON platform.advance_payout_schedules;
CREATE POLICY svc_platform_advance_payout_schedules ON platform.advance_payout_schedules FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_platform_bank_credentials ON platform.bank_credentials;
CREATE POLICY svc_platform_bank_credentials ON platform.bank_credentials FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_platform_dashboard_layouts ON platform.dashboard_layouts;
CREATE POLICY svc_platform_dashboard_layouts ON platform.dashboard_layouts FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_platform_email_templates ON platform.email_templates;
CREATE POLICY svc_platform_email_templates ON platform.email_templates FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_platform_fee_schedules ON platform.fee_schedules;
CREATE POLICY svc_platform_fee_schedules ON platform.fee_schedules FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_platform_member_groups ON platform.member_groups;
CREATE POLICY svc_platform_member_groups ON platform.member_groups FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_platform_promoter_branding ON platform.promoter_branding;
CREATE POLICY svc_platform_promoter_branding ON platform.promoter_branding FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_platform_promoter_documents ON platform.promoter_documents;
CREATE POLICY svc_platform_promoter_documents ON platform.promoter_documents FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_platform_promoter_domains ON platform.promoter_domains;
CREATE POLICY svc_platform_promoter_domains ON platform.promoter_domains FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_platform_refund_policies ON platform.refund_policies;
CREATE POLICY svc_platform_refund_policies ON platform.refund_policies FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_platform_staff_members ON platform.staff_members;
CREATE POLICY svc_platform_staff_members ON platform.staff_members FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_platform_staff_shifts ON platform.staff_shifts;
CREATE POLICY svc_platform_staff_shifts ON platform.staff_shifts FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_platform_team_invites ON platform.team_invites;
CREATE POLICY svc_platform_team_invites ON platform.team_invites FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_pos_pos_sessions ON pos.pos_sessions;
CREATE POLICY svc_pos_pos_sessions ON pos.pos_sessions FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_pos_tap_to_pay_sessions ON pos.tap_to_pay_sessions;
CREATE POLICY svc_pos_tap_to_pay_sessions ON pos.tap_to_pay_sessions FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_pricing_organizer_pricing_config ON pricing.organizer_pricing_config;
CREATE POLICY svc_pricing_organizer_pricing_config ON pricing.organizer_pricing_config FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_promo_bogo_rules ON promo.bogo_rules;
CREATE POLICY svc_promo_bogo_rules ON promo.bogo_rules FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_public_age_verifications ON public.age_verifications;
CREATE POLICY svc_public_age_verifications ON public.age_verifications FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_public_checkout_addons ON public.checkout_addons;
CREATE POLICY svc_public_checkout_addons ON public.checkout_addons FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_public_event_insurance_policies ON public.event_insurance_policies;
CREATE POLICY svc_public_event_insurance_policies ON public.event_insurance_policies FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_public_fan_registrations_v2 ON public.fan_registrations_v2;
CREATE POLICY svc_public_fan_registrations_v2 ON public.fan_registrations_v2 FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_public_fnb_menu_items ON public.fnb_menu_items;
CREATE POLICY svc_public_fnb_menu_items ON public.fnb_menu_items FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_public_fnb_preorders ON public.fnb_preorders;
CREATE POLICY svc_public_fnb_preorders ON public.fnb_preorders FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_public_insurance_claims ON public.insurance_claims;
CREATE POLICY svc_public_insurance_claims ON public.insurance_claims FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_public_onboarding_wizard_sessions ON public.onboarding_wizard_sessions;
CREATE POLICY svc_public_onboarding_wizard_sessions ON public.onboarding_wizard_sessions FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_public_presale_events ON public.presale_events;
CREATE POLICY svc_public_presale_events ON public.presale_events FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_public_refunds ON public.refunds;
CREATE POLICY svc_public_refunds ON public.refunds FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_public_ticket_payment_plans ON public.ticket_payment_plans;
CREATE POLICY svc_public_ticket_payment_plans ON public.ticket_payment_plans FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_public_wcag_audit_log ON public.wcag_audit_log;
CREATE POLICY svc_public_wcag_audit_log ON public.wcag_audit_log FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_resale_resale_rules ON resale.resale_rules;
CREATE POLICY svc_resale_resale_rules ON resale.resale_rules FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_approval_requests ON reservations.approval_requests;
CREATE POLICY svc_reservations_approval_requests ON reservations.approval_requests FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_booking_receipts ON reservations.booking_receipts;
CREATE POLICY svc_reservations_booking_receipts ON reservations.booking_receipts FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_bookings ON reservations.bookings;
CREATE POLICY svc_reservations_bookings ON reservations.bookings FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_branches ON reservations.branches;
CREATE POLICY svc_reservations_branches ON reservations.branches FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_customer_favorites ON reservations.customer_favorites;
CREATE POLICY svc_reservations_customer_favorites ON reservations.customer_favorites FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_customer_notes ON reservations.customer_notes;
CREATE POLICY svc_reservations_customer_notes ON reservations.customer_notes FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_customer_profiles ON reservations.customer_profiles;
CREATE POLICY svc_reservations_customer_profiles ON reservations.customer_profiles FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_package_purchases ON reservations.package_purchases;
CREATE POLICY svc_reservations_package_purchases ON reservations.package_purchases FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_packages ON reservations.packages;
CREATE POLICY svc_reservations_packages ON reservations.packages FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_resources ON reservations.resources;
CREATE POLICY svc_reservations_resources ON reservations.resources FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_rules ON reservations.rules;
CREATE POLICY svc_reservations_rules ON reservations.rules FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_service_categories ON reservations.service_categories;
CREATE POLICY svc_reservations_service_categories ON reservations.service_categories FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_services ON reservations.services;
CREATE POLICY svc_reservations_services ON reservations.services FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_waitlist_entries ON reservations.waitlist_entries;
CREATE POLICY svc_reservations_waitlist_entries ON reservations.waitlist_entries FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_webhook_endpoints ON reservations.webhook_endpoints;
CREATE POLICY svc_reservations_webhook_endpoints ON reservations.webhook_endpoints FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_reservations_webhook_event_log ON reservations.webhook_event_log;
CREATE POLICY svc_reservations_webhook_event_log ON reservations.webhook_event_log FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_revenue_price_scenarios ON revenue.price_scenarios;
CREATE POLICY svc_revenue_price_scenarios ON revenue.price_scenarios FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_revenue_pricing_scenarios ON revenue.pricing_scenarios;
CREATE POLICY svc_revenue_pricing_scenarios ON revenue.pricing_scenarios FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_revenue_projections ON revenue.projections;
CREATE POLICY svc_revenue_projections ON revenue.projections FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_revenue_sales_stream ON revenue.sales_stream;
CREATE POLICY svc_revenue_sales_stream ON revenue.sales_stream FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_risk_fraud_cases ON risk.fraud_cases;
CREATE POLICY svc_risk_fraud_cases ON risk.fraud_cases FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_segmentation_export_jobs ON segmentation.export_jobs;
CREATE POLICY svc_segmentation_export_jobs ON segmentation.export_jobs FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_segmentation_segments ON segmentation.segments;
CREATE POLICY svc_segmentation_segments ON segmentation.segments FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_social_event_shares ON social.event_shares;
CREATE POLICY svc_social_event_shares ON social.event_shares FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_sport_leagues ON sport.leagues;
CREATE POLICY svc_sport_leagues ON sport.leagues FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_sport_multi_game_packages ON sport.multi_game_packages;
CREATE POLICY svc_sport_multi_game_packages ON sport.multi_game_packages FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_sport_season_ticket_holders ON sport.season_ticket_holders;
CREATE POLICY svc_sport_season_ticket_holders ON sport.season_ticket_holders FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_sport_teams ON sport.teams;
CREATE POLICY svc_sport_teams ON sport.teams FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_subscriptions_packages ON subscriptions.packages;
CREATE POLICY svc_subscriptions_packages ON subscriptions.packages FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_subscriptions_plans ON subscriptions.plans;
CREATE POLICY svc_subscriptions_plans ON subscriptions.plans FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_surveys_surveys ON surveys.surveys;
CREATE POLICY svc_surveys_surveys ON surveys.surveys FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_tours_series ON tours.series;
CREATE POLICY svc_tours_series ON tours.series FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_validation_event_entry_modes ON validation.event_entry_modes;
CREATE POLICY svc_validation_event_entry_modes ON validation.event_entry_modes FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_venues_cultural_venues ON venues.cultural_venues;
CREATE POLICY svc_venues_cultural_venues ON venues.cultural_venues FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_venues_entry_bookings ON venues.entry_bookings;
CREATE POLICY svc_venues_entry_bookings ON venues.entry_bookings FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_venues_escape_venues ON venues.escape_venues;
CREATE POLICY svc_venues_escape_venues ON venues.escape_venues FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_venues_ski_resorts ON venues.ski_resorts;
CREATE POLICY svc_venues_ski_resorts ON venues.ski_resorts FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_venues_sports_clubs ON venues.sports_clubs;
CREATE POLICY svc_venues_sports_clubs ON venues.sports_clubs FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_venues_wellness_bookings ON venues.wellness_bookings;
CREATE POLICY svc_venues_wellness_bookings ON venues.wellness_bookings FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_venues_wellness_facilities ON venues.wellness_facilities;
CREATE POLICY svc_venues_wellness_facilities ON venues.wellness_facilities FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());
DROP POLICY IF EXISTS svc_waiting_room_queues ON waiting_room.queues;
CREATE POLICY svc_waiting_room_queues ON waiting_room.queues FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

-- ===== migrations/347_payment_plans_public_read.sql =====
-- 347_payment_plans_public_read.sql
--
-- BUG FIX: připojení splátkového plánu k objednávce (POST /api/buyer/orders/[id]/
-- payment-plan) běží v BUYER kontextu, ale catalog.payment_plans má jen
-- promotér-tenant policy → kupující plán NEVIDÍ → PLAN_NOT_FOUND (404), i když
-- plán existuje a je aktivní.
--
-- Splátkové plány jsou VEŘEJNÉ nabídky vázané na akci (kupující si musí vybrat,
-- stejně jako vidí ceny lístků). Přidáváme public SELECT policy pro aktivní plány.
-- Promotér-tenant policy dál řídí zápis (create/edit).

CREATE POLICY p_payment_plans_public_read ON catalog.payment_plans
  FOR SELECT USING (active = true);

-- ===== migrations/348_fb_qr_promoter_context.sql =====
-- 348_fb_qr_promoter_context.sql
--
-- BUG FIX: facebook_pages / qr_campaigns / event_fb_publishes RLS policies
-- kontrolovaly vlastnictví JEN přes promoter_members.user_id = app_current_user_id().
-- Jenže tyto tabulky obsluhují PROMOTÉR-kontextové endpointy (publish-facebook,
-- QR admin), které nastavují app_current_promoter_id (NE app_current_user_id) →
-- promotér své FB stránky / QR kampaně NEVIDĚL (PAGE_NOT_CONNECTED / prázdno).
-- Service kontext je taky nevidí (chybí app_is_service).
--
-- Fix: přidat app_is_service() + přímou app_current_promoter_id() cestu; ponechat
-- i původní user_id cestu (user-kontext s promoter membership). app_is_service()
-- první kvůli short-circuit.

DROP POLICY IF EXISTS fb_pages_promoter_isolation ON marketing.facebook_pages;
CREATE POLICY fb_pages_promoter_isolation ON marketing.facebook_pages
  FOR ALL USING (
    app_is_service()
    OR app_is_platform_admin()
    OR promoter_id = app_current_promoter_id()
    OR promoter_id IN (SELECT promoter_id FROM platform.promoter_members WHERE user_id = app_current_user_id())
  );

DROP POLICY IF EXISTS qr_campaigns_promoter_isolation ON marketing.qr_campaigns;
CREATE POLICY qr_campaigns_promoter_isolation ON marketing.qr_campaigns
  FOR ALL USING (
    app_is_service()
    OR app_is_platform_admin()
    OR event_id IN (SELECT id FROM catalog.events WHERE promoter_id = app_current_promoter_id())
    OR event_id IN (SELECT e.id FROM catalog.events e JOIN platform.promoter_members pm ON pm.promoter_id = e.promoter_id WHERE pm.user_id = app_current_user_id())
  );

DROP POLICY IF EXISTS fb_publishes_promoter_isolation ON catalog.event_fb_publishes;
CREATE POLICY fb_publishes_promoter_isolation ON catalog.event_fb_publishes
  FOR ALL USING (
    app_is_service()
    OR app_is_platform_admin()
    OR event_id IN (SELECT id FROM catalog.events WHERE promoter_id = app_current_promoter_id())
    OR event_id IN (SELECT e.id FROM catalog.events e JOIN platform.promoter_members pm ON pm.promoter_id = e.promoter_id WHERE pm.user_id = app_current_user_id())
  );

COMMIT;
