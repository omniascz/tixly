-- 482_rls_tables_without_rls.sql — kolo 2 / krok 3B (GENEROVÁNO audit/r2/gen-482.mjs)
--
-- Audit L7: 156 tabulek bez RLS čitelných (i zapisovatelných) rolí tixly_app bez ohledu na tenanta.
-- Tabulky s daty tenantu nebo uživatele: RLS + politiky (svc/admin + vlastník [+ veřejné čtení]).
-- Systémové a číselníkové tabulky: bez RLS, tixly_app jen SELECT (+ zápisy, které kód dělá).
-- Navíc: tixly_app ztrácí TRUNCATE na všech tabulkách (TRUNCATE obchází RLS; kód ho nepoužívá).
-- Rozhodnutí a odůvodnění po tabulkách: logs/r2/3B_tables_decision.md. Idempotentní.

BEGIN;

-- accessibility.companion_pairs  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE accessibility.companion_pairs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_companion_pairs ON accessibility.companion_pairs;
CREATE POLICY svc_admin_companion_pairs ON accessibility.companion_pairs FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON accessibility.companion_pairs FROM tixly_app;

-- accreditation.accreditation_scans  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE accreditation.accreditation_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_accreditation_scans ON accreditation.accreditation_scans;
CREATE POLICY svc_admin_accreditation_scans ON accreditation.accreditation_scans FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON accreditation.accreditation_scans FROM tixly_app;

-- affiliate.clicks  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE affiliate.clicks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_clicks ON affiliate.clicks;
CREATE POLICY svc_admin_clicks ON affiliate.clicks FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON affiliate.clicks FROM tixly_app;

-- affiliate.payouts  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE affiliate.payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_payouts ON affiliate.payouts;
CREATE POLICY svc_admin_payouts ON affiliate.payouts FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON affiliate.payouts FROM tixly_app;

-- ambassador.codes  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE ambassador.codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_codes ON ambassador.codes;
CREATE POLICY svc_admin_codes ON ambassador.codes FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON ambassador.codes FROM tixly_app;

-- ambassador.payouts  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE ambassador.payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_payouts ON ambassador.payouts;
CREATE POLICY svc_admin_payouts ON ambassador.payouts FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON ambassador.payouts FROM tixly_app;

-- analytics.audience_geo  [TENANT] geodata kupců akce (event_id)
ALTER TABLE analytics.audience_geo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_audience_geo ON analytics.audience_geo;
CREATE POLICY svc_admin_audience_geo ON analytics.audience_geo FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_audience_geo ON analytics.audience_geo;
CREATE POLICY owner_audience_geo ON analytics.audience_geo FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = audience_geo.event_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = audience_geo.event_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON analytics.audience_geo FROM tixly_app;

-- analytics.event_sales_snapshots  [TENANT] prodejní snapshoty akce
ALTER TABLE analytics.event_sales_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_event_sales_snapshots ON analytics.event_sales_snapshots;
CREATE POLICY svc_admin_event_sales_snapshots ON analytics.event_sales_snapshots FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_event_sales_snapshots ON analytics.event_sales_snapshots;
CREATE POLICY owner_event_sales_snapshots ON analytics.event_sales_snapshots FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = event_sales_snapshots.event_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = event_sales_snapshots.event_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON analytics.event_sales_snapshots FROM tixly_app;

-- audit.audit_log  [TENANT] auditní stopa se starými/novými hodnotami (osobní údaje) všech tenantů; append-only
ALTER TABLE audit.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_audit_log ON audit.audit_log;
CREATE POLICY svc_admin_audit_log ON audit.audit_log FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS append_audit_log ON audit.audit_log;
CREATE POLICY append_audit_log ON audit.audit_log FOR INSERT
  WITH CHECK (true);
DROP POLICY IF EXISTS tenant_read_audit_log ON audit.audit_log;
CREATE POLICY tenant_read_audit_log ON audit.audit_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM platform.promoter_members m WHERE m.user_id = audit_log.actor_id AND m.promoter_id = public.app_current_promoter_id())
   OR (audit_log.schema_name = 'orders' AND audit_log.table_name = 'orders'
       AND EXISTS (SELECT 1 FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
                    WHERE o.id::text = audit_log.record_id AND e.promoter_id = public.app_current_promoter_id())));
REVOKE TRUNCATE ON audit.audit_log FROM tixly_app;

-- audit.content_reports_rate_limit  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE audit.content_reports_rate_limit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_content_reports_rate_limit ON audit.content_reports_rate_limit;
CREATE POLICY svc_admin_content_reports_rate_limit ON audit.content_reports_rate_limit FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON audit.content_reports_rate_limit FROM tixly_app;

-- audit.support_actions  [TENANT] zásahy podpory pořadatele (actor_promoter_id)
ALTER TABLE audit.support_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_support_actions ON audit.support_actions;
CREATE POLICY svc_admin_support_actions ON audit.support_actions FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_support_actions ON audit.support_actions;
CREATE POLICY owner_support_actions ON audit.support_actions FOR ALL
  USING (support_actions.actor_promoter_id = public.app_current_promoter_id())
  WITH CHECK (support_actions.actor_promoter_id = public.app_current_promoter_id());
REVOKE TRUNCATE ON audit.support_actions FROM tixly_app;

-- b2b.api_rate_limit_log  [LOCKED] log volání API klientů tenantů; píše/čte jen servis
ALTER TABLE b2b.api_rate_limit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_api_rate_limit_log ON b2b.api_rate_limit_log;
CREATE POLICY svc_admin_api_rate_limit_log ON b2b.api_rate_limit_log FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON b2b.api_rate_limit_log FROM tixly_app;

-- b2b.oauth_clients  [TENANT] OAuth aplikace pořadatele/uživatele (secret); kupec čte aplikace, kterým udělil přístup
ALTER TABLE b2b.oauth_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_oauth_clients ON b2b.oauth_clients;
CREATE POLICY svc_admin_oauth_clients ON b2b.oauth_clients FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_oauth_clients ON b2b.oauth_clients;
CREATE POLICY owner_oauth_clients ON b2b.oauth_clients FOR ALL
  USING ((oauth_clients.owner_promoter_id = public.app_current_promoter_id() OR oauth_clients.owner_user_id = public.app_current_user_id()))
  WITH CHECK ((oauth_clients.owner_promoter_id = public.app_current_promoter_id() OR oauth_clients.owner_user_id = public.app_current_user_id()));
DROP POLICY IF EXISTS read_oauth_clients ON b2b.oauth_clients;
CREATE POLICY read_oauth_clients ON b2b.oauth_clients FOR SELECT
  USING (EXISTS (SELECT 1 FROM b2b.oauth_access_tokens at WHERE at.client_id = oauth_clients.id AND at.user_id = public.app_current_user_id()));
REVOKE TRUNCATE ON b2b.oauth_clients FROM tixly_app;

-- b2b.sandbox_fixtures  [SYSTEM] testovací data sandboxu API
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON b2b.sandbox_fixtures FROM tixly_app;
GRANT SELECT ON b2b.sandbox_fixtures TO tixly_app;

-- b2b.webhook_deliveries  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE b2b.webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_webhook_deliveries ON b2b.webhook_deliveries;
CREATE POLICY svc_admin_webhook_deliveries ON b2b.webhook_deliveries FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON b2b.webhook_deliveries FROM tixly_app;

-- b2b.webhook_subscriptions  [LOCKED] webhooky API klientů; jen servis (v3 API)
ALTER TABLE b2b.webhook_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_webhook_subscriptions ON b2b.webhook_subscriptions;
CREATE POLICY svc_admin_webhook_subscriptions ON b2b.webhook_subscriptions FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON b2b.webhook_subscriptions FROM tixly_app;

-- benefit_payments.providers  [SYSTEM] číselník benefitních poskytovatelů
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON benefit_payments.providers FROM tixly_app;
GRANT SELECT ON benefit_payments.providers TO tixly_app;

-- brands.advertisers  [SYSTEM] adresář inzerentů platformy (ne data tenantu); čtou ho pořadatelé v nabídkách
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON brands.advertisers FROM tixly_app;
GRANT SELECT ON brands.advertisers TO tixly_app;
GRANT INSERT ON brands.advertisers TO tixly_app;

-- brands.campaigns  [SYSTEM] katalog kampaní inzerentů platformy nabízený pořadatelům
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON brands.campaigns FROM tixly_app;
GRANT SELECT ON brands.campaigns TO tixly_app;
GRANT INSERT, UPDATE ON brands.campaigns TO tixly_app;

-- brands.impressions  [TENANT] impresse na akci pořadatele
ALTER TABLE brands.impressions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_impressions ON brands.impressions;
CREATE POLICY svc_admin_impressions ON brands.impressions FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_impressions ON brands.impressions;
CREATE POLICY owner_impressions ON brands.impressions FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = impressions.event_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = impressions.event_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON brands.impressions FROM tixly_app;

-- catalog.ab_price_assignments  [TENANT] A/B přiřazení cen (přes ab_price_tests → ticket_type)
ALTER TABLE catalog.ab_price_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_ab_price_assignments ON catalog.ab_price_assignments;
CREATE POLICY svc_admin_ab_price_assignments ON catalog.ab_price_assignments FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_ab_price_assignments ON catalog.ab_price_assignments;
CREATE POLICY owner_ab_price_assignments ON catalog.ab_price_assignments FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.ab_price_tests x WHERE x.id = ab_price_assignments.test_id))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.ab_price_tests x WHERE x.id = ab_price_assignments.test_id));
REVOKE TRUNCATE ON catalog.ab_price_assignments FROM tixly_app;

-- catalog.ab_price_tests  [TENANT] A/B test cen typu vstupenky
ALTER TABLE catalog.ab_price_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_ab_price_tests ON catalog.ab_price_tests;
CREATE POLICY svc_admin_ab_price_tests ON catalog.ab_price_tests FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_ab_price_tests ON catalog.ab_price_tests;
CREATE POLICY owner_ab_price_tests ON catalog.ab_price_tests FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = ab_price_tests.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = ab_price_tests.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON catalog.ab_price_tests FROM tixly_app;

-- catalog.access_code_ticket_types  [TENANT] vazba přístupových kódů pořadatele
ALTER TABLE catalog.access_code_ticket_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_access_code_ticket_types ON catalog.access_code_ticket_types;
CREATE POLICY svc_admin_access_code_ticket_types ON catalog.access_code_ticket_types FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_access_code_ticket_types ON catalog.access_code_ticket_types;
CREATE POLICY owner_access_code_ticket_types ON catalog.access_code_ticket_types FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.access_codes ac WHERE ac.id = access_code_ticket_types.access_code_id AND ac.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.access_codes ac WHERE ac.id = access_code_ticket_types.access_code_id AND ac.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON catalog.access_code_ticket_types FROM tixly_app;

-- catalog.backstage_moments  [TENANT] backstage obsah akce; veřejně čten (NOCTX /api/backstage) u publikované akce
ALTER TABLE catalog.backstage_moments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_backstage_moments ON catalog.backstage_moments;
CREATE POLICY svc_admin_backstage_moments ON catalog.backstage_moments FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_backstage_moments ON catalog.backstage_moments;
CREATE POLICY owner_backstage_moments ON catalog.backstage_moments FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = backstage_moments.event_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = backstage_moments.event_id AND e.promoter_id = public.app_current_promoter_id()));
DROP POLICY IF EXISTS read_backstage_moments ON catalog.backstage_moments;
CREATE POLICY read_backstage_moments ON catalog.backstage_moments FOR SELECT
  USING (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = backstage_moments.event_id AND e.status = 'published'));
REVOKE TRUNCATE ON catalog.backstage_moments FROM tixly_app;

-- catalog.cinema_screens  [TENANT] plátna kina místa; veřejné údaje (NOCTX /api/cinema)
ALTER TABLE catalog.cinema_screens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_cinema_screens ON catalog.cinema_screens;
CREATE POLICY svc_admin_cinema_screens ON catalog.cinema_screens FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_cinema_screens ON catalog.cinema_screens;
CREATE POLICY owner_cinema_screens ON catalog.cinema_screens FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.venues v WHERE v.id = cinema_screens.venue_id AND v.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.venues v WHERE v.id = cinema_screens.venue_id AND v.promoter_id = public.app_current_promoter_id()));
DROP POLICY IF EXISTS read_cinema_screens ON catalog.cinema_screens;
CREATE POLICY read_cinema_screens ON catalog.cinema_screens FOR SELECT
  USING (true);
REVOKE TRUNCATE ON catalog.cinema_screens FROM tixly_app;

-- catalog.commemorative_templates  [TENANT] šablony pamětních vstupenek akce
ALTER TABLE catalog.commemorative_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_commemorative_templates ON catalog.commemorative_templates;
CREATE POLICY svc_admin_commemorative_templates ON catalog.commemorative_templates FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_commemorative_templates ON catalog.commemorative_templates;
CREATE POLICY owner_commemorative_templates ON catalog.commemorative_templates FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = commemorative_templates.event_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = commemorative_templates.event_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON catalog.commemorative_templates FROM tixly_app;

-- catalog.discount_pricing_rules  [TENANT] cenová pravidla typu vstupenky
ALTER TABLE catalog.discount_pricing_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_discount_pricing_rules ON catalog.discount_pricing_rules;
CREATE POLICY svc_admin_discount_pricing_rules ON catalog.discount_pricing_rules FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_discount_pricing_rules ON catalog.discount_pricing_rules;
CREATE POLICY owner_discount_pricing_rules ON catalog.discount_pricing_rules FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = discount_pricing_rules.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = discount_pricing_rules.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON catalog.discount_pricing_rules FROM tixly_app;

-- catalog.dynamic_pricing_rules  [TENANT] dynamické ceny typu vstupenky
ALTER TABLE catalog.dynamic_pricing_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_dynamic_pricing_rules ON catalog.dynamic_pricing_rules;
CREATE POLICY svc_admin_dynamic_pricing_rules ON catalog.dynamic_pricing_rules FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_dynamic_pricing_rules ON catalog.dynamic_pricing_rules;
CREATE POLICY owner_dynamic_pricing_rules ON catalog.dynamic_pricing_rules FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = dynamic_pricing_rules.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = dynamic_pricing_rules.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON catalog.dynamic_pricing_rules FROM tixly_app;

-- catalog.event_bundle_addons  [TENANT] doplňky balíčků akce; veřejně čteny (NOCTX /api/events/[id]/bundles)
ALTER TABLE catalog.event_bundle_addons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_event_bundle_addons ON catalog.event_bundle_addons;
CREATE POLICY svc_admin_event_bundle_addons ON catalog.event_bundle_addons FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_event_bundle_addons ON catalog.event_bundle_addons;
CREATE POLICY owner_event_bundle_addons ON catalog.event_bundle_addons FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.event_bundles b JOIN catalog.events e ON e.id = b.event_id WHERE b.id = event_bundle_addons.bundle_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.event_bundles b JOIN catalog.events e ON e.id = b.event_id WHERE b.id = event_bundle_addons.bundle_id AND e.promoter_id = public.app_current_promoter_id()));
DROP POLICY IF EXISTS read_event_bundle_addons ON catalog.event_bundle_addons;
CREATE POLICY read_event_bundle_addons ON catalog.event_bundle_addons FOR SELECT
  USING (EXISTS (SELECT 1 FROM catalog.event_bundles b JOIN catalog.events e ON e.id = b.event_id WHERE b.id = event_bundle_addons.bundle_id AND e.status = 'published'));
REVOKE TRUNCATE ON catalog.event_bundle_addons FROM tixly_app;

-- catalog.flex_pass_settings  [TENANT] nastavení flex passu typu; veřejně čteno (ticket-types)
ALTER TABLE catalog.flex_pass_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_flex_pass_settings ON catalog.flex_pass_settings;
CREATE POLICY svc_admin_flex_pass_settings ON catalog.flex_pass_settings FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_flex_pass_settings ON catalog.flex_pass_settings;
CREATE POLICY owner_flex_pass_settings ON catalog.flex_pass_settings FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = flex_pass_settings.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = flex_pass_settings.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()));
DROP POLICY IF EXISTS read_flex_pass_settings ON catalog.flex_pass_settings;
CREATE POLICY read_flex_pass_settings ON catalog.flex_pass_settings FOR SELECT
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = flex_pass_settings.ticket_type_id AND e.status = 'published'));
REVOKE TRUNCATE ON catalog.flex_pass_settings FROM tixly_app;

-- catalog.foyer_menu_items  [TENANT] menu foyer akce; veřejně čteno
ALTER TABLE catalog.foyer_menu_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_foyer_menu_items ON catalog.foyer_menu_items;
CREATE POLICY svc_admin_foyer_menu_items ON catalog.foyer_menu_items FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_foyer_menu_items ON catalog.foyer_menu_items;
CREATE POLICY owner_foyer_menu_items ON catalog.foyer_menu_items FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = foyer_menu_items.event_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = foyer_menu_items.event_id AND e.promoter_id = public.app_current_promoter_id()));
DROP POLICY IF EXISTS read_foyer_menu_items ON catalog.foyer_menu_items;
CREATE POLICY read_foyer_menu_items ON catalog.foyer_menu_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = foyer_menu_items.event_id AND e.status = 'published'));
REVOKE TRUNCATE ON catalog.foyer_menu_items FROM tixly_app;

-- catalog.group_discount_tiers  [TENANT] skupinové slevy typu (veřejná informace)
ALTER TABLE catalog.group_discount_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_group_discount_tiers ON catalog.group_discount_tiers;
CREATE POLICY svc_admin_group_discount_tiers ON catalog.group_discount_tiers FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_group_discount_tiers ON catalog.group_discount_tiers;
CREATE POLICY owner_group_discount_tiers ON catalog.group_discount_tiers FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = group_discount_tiers.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = group_discount_tiers.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()));
DROP POLICY IF EXISTS read_group_discount_tiers ON catalog.group_discount_tiers;
CREATE POLICY read_group_discount_tiers ON catalog.group_discount_tiers FOR SELECT
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = group_discount_tiers.ticket_type_id AND e.status = 'published'));
REVOKE TRUNCATE ON catalog.group_discount_tiers FROM tixly_app;

-- catalog.lastminute_rules  [TENANT] last-minute pravidla akce
ALTER TABLE catalog.lastminute_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_lastminute_rules ON catalog.lastminute_rules;
CREATE POLICY svc_admin_lastminute_rules ON catalog.lastminute_rules FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_lastminute_rules ON catalog.lastminute_rules;
CREATE POLICY owner_lastminute_rules ON catalog.lastminute_rules FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = lastminute_rules.event_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = lastminute_rules.event_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON catalog.lastminute_rules FROM tixly_app;

-- catalog.member_pricing_rules  [TENANT] členské ceny typu
ALTER TABLE catalog.member_pricing_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_member_pricing_rules ON catalog.member_pricing_rules;
CREATE POLICY svc_admin_member_pricing_rules ON catalog.member_pricing_rules FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_member_pricing_rules ON catalog.member_pricing_rules;
CREATE POLICY owner_member_pricing_rules ON catalog.member_pricing_rules FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = member_pricing_rules.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = member_pricing_rules.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON catalog.member_pricing_rules FROM tixly_app;

-- catalog.moderation_blocklist  [SYSTEM] globální seznam zakázaných slov moderace
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON catalog.moderation_blocklist FROM tixly_app;
GRANT SELECT ON catalog.moderation_blocklist TO tixly_app;

-- catalog.pricing_rules  [TENANT] cenová pravidla typu
ALTER TABLE catalog.pricing_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_pricing_rules ON catalog.pricing_rules;
CREATE POLICY svc_admin_pricing_rules ON catalog.pricing_rules FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_pricing_rules ON catalog.pricing_rules;
CREATE POLICY owner_pricing_rules ON catalog.pricing_rules FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = pricing_rules.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = pricing_rules.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON catalog.pricing_rules FROM tixly_app;

-- catalog.pricing_windows  [TENANT] cenová okna typu
ALTER TABLE catalog.pricing_windows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_pricing_windows ON catalog.pricing_windows;
CREATE POLICY svc_admin_pricing_windows ON catalog.pricing_windows FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_pricing_windows ON catalog.pricing_windows;
CREATE POLICY owner_pricing_windows ON catalog.pricing_windows FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = pricing_windows.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = pricing_windows.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON catalog.pricing_windows FROM tixly_app;

-- catalog.program_cast_entries  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE catalog.program_cast_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_program_cast_entries ON catalog.program_cast_entries;
CREATE POLICY svc_admin_program_cast_entries ON catalog.program_cast_entries FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON catalog.program_cast_entries FROM tixly_app;

-- catalog.seats  [TENANT] sedadla místa (fyzika sálu, veřejná); zápis jen vlastník místa
ALTER TABLE catalog.seats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_seats ON catalog.seats;
CREATE POLICY svc_admin_seats ON catalog.seats FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_seats ON catalog.seats;
CREATE POLICY owner_seats ON catalog.seats FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.venues v WHERE v.id = seats.venue_id AND v.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.venues v WHERE v.id = seats.venue_id AND v.promoter_id = public.app_current_promoter_id()));
DROP POLICY IF EXISTS read_seats ON catalog.seats;
CREATE POLICY read_seats ON catalog.seats FOR SELECT
  USING (true);
REVOKE TRUNCATE ON catalog.seats FROM tixly_app;

-- catalog.ticket_modular_pricing  [TENANT] modulární ceny; veřejně čteny (modular-pass)
ALTER TABLE catalog.ticket_modular_pricing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_ticket_modular_pricing ON catalog.ticket_modular_pricing;
CREATE POLICY svc_admin_ticket_modular_pricing ON catalog.ticket_modular_pricing FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_ticket_modular_pricing ON catalog.ticket_modular_pricing;
CREATE POLICY owner_ticket_modular_pricing ON catalog.ticket_modular_pricing FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = ticket_modular_pricing.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = ticket_modular_pricing.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()));
DROP POLICY IF EXISTS read_ticket_modular_pricing ON catalog.ticket_modular_pricing;
CREATE POLICY read_ticket_modular_pricing ON catalog.ticket_modular_pricing FOR SELECT
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = ticket_modular_pricing.ticket_type_id AND e.status = 'published'));
REVOKE TRUNCATE ON catalog.ticket_modular_pricing FROM tixly_app;

-- catalog.ticket_type_access  [TENANT] přístupová matice typu; veřejně čtena (stránka akce)
ALTER TABLE catalog.ticket_type_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_ticket_type_access ON catalog.ticket_type_access;
CREATE POLICY svc_admin_ticket_type_access ON catalog.ticket_type_access FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_ticket_type_access ON catalog.ticket_type_access;
CREATE POLICY owner_ticket_type_access ON catalog.ticket_type_access FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = ticket_type_access.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = ticket_type_access.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()));
DROP POLICY IF EXISTS read_ticket_type_access ON catalog.ticket_type_access;
CREATE POLICY read_ticket_type_access ON catalog.ticket_type_access FOR SELECT
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = ticket_type_access.ticket_type_id AND e.status = 'published'));
REVOKE TRUNCATE ON catalog.ticket_type_access FROM tixly_app;

-- catalog.ticket_type_channel_prices  [TENANT] ceny typu podle kanálu
ALTER TABLE catalog.ticket_type_channel_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_ticket_type_channel_prices ON catalog.ticket_type_channel_prices;
CREATE POLICY svc_admin_ticket_type_channel_prices ON catalog.ticket_type_channel_prices FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_ticket_type_channel_prices ON catalog.ticket_type_channel_prices;
CREATE POLICY owner_ticket_type_channel_prices ON catalog.ticket_type_channel_prices FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = ticket_type_channel_prices.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = ticket_type_channel_prices.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON catalog.ticket_type_channel_prices FROM tixly_app;

-- catalog.ticket_type_price_history  [TENANT] historie cen typu
ALTER TABLE catalog.ticket_type_price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_ticket_type_price_history ON catalog.ticket_type_price_history;
CREATE POLICY svc_admin_ticket_type_price_history ON catalog.ticket_type_price_history FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_ticket_type_price_history ON catalog.ticket_type_price_history;
CREATE POLICY owner_ticket_type_price_history ON catalog.ticket_type_price_history FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = ticket_type_price_history.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = ticket_type_price_history.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON catalog.ticket_type_price_history FROM tixly_app;

-- catalog.venue_seating_charts  [TENANT] plánek sálu (veřejný, NOCTX /seats); zápis jen vlastník místa
ALTER TABLE catalog.venue_seating_charts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_venue_seating_charts ON catalog.venue_seating_charts;
CREATE POLICY svc_admin_venue_seating_charts ON catalog.venue_seating_charts FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_venue_seating_charts ON catalog.venue_seating_charts;
CREATE POLICY owner_venue_seating_charts ON catalog.venue_seating_charts FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.venues v WHERE v.id = venue_seating_charts.venue_id AND v.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.venues v WHERE v.id = venue_seating_charts.venue_id AND v.promoter_id = public.app_current_promoter_id()));
DROP POLICY IF EXISTS read_venue_seating_charts ON catalog.venue_seating_charts;
CREATE POLICY read_venue_seating_charts ON catalog.venue_seating_charts FOR SELECT
  USING (true);
REVOKE TRUNCATE ON catalog.venue_seating_charts FROM tixly_app;

-- catalog.volume_discount_rules  [TENANT] množstevní slevy typu
ALTER TABLE catalog.volume_discount_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_volume_discount_rules ON catalog.volume_discount_rules;
CREATE POLICY svc_admin_volume_discount_rules ON catalog.volume_discount_rules FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_volume_discount_rules ON catalog.volume_discount_rules;
CREATE POLICY owner_volume_discount_rules ON catalog.volume_discount_rules FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = volume_discount_rules.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = volume_discount_rules.ticket_type_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON catalog.volume_discount_rules FROM tixly_app;

-- channels.channel_providers  [SYSTEM] číselník prodejních kanálů
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON channels.channel_providers FROM tixly_app;
GRANT SELECT ON channels.channel_providers TO tixly_app;

-- channels.sync_log  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE channels.sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_sync_log ON channels.sync_log;
CREATE POLICY svc_admin_sync_log ON channels.sync_log FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON channels.sync_log FROM tixly_app;

-- communications.announcement_responses  [TENANT] odpovědi kupců na krizová oznámení pořadatele
ALTER TABLE communications.announcement_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_announcement_responses ON communications.announcement_responses;
CREATE POLICY svc_admin_announcement_responses ON communications.announcement_responses FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_announcement_responses ON communications.announcement_responses;
CREATE POLICY owner_announcement_responses ON communications.announcement_responses FOR ALL
  USING (EXISTS (SELECT 1 FROM communications.emergency_announcements a WHERE a.id = announcement_responses.announcement_id AND a.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM communications.emergency_announcements a WHERE a.id = announcement_responses.announcement_id AND a.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON communications.announcement_responses FROM tixly_app;

-- conference.badge_overrides  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE conference.badge_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_badge_overrides ON conference.badge_overrides;
CREATE POLICY svc_admin_badge_overrides ON conference.badge_overrides FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON conference.badge_overrides FROM tixly_app;

-- conference.badge_print_jobs  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE conference.badge_print_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_badge_print_jobs ON conference.badge_print_jobs;
CREATE POLICY svc_admin_badge_print_jobs ON conference.badge_print_jobs FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON conference.badge_print_jobs FROM tixly_app;

-- conference.badge_templates  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE conference.badge_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_badge_templates ON conference.badge_templates;
CREATE POLICY svc_admin_badge_templates ON conference.badge_templates FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON conference.badge_templates FROM tixly_app;

-- conference.booth_categories  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE conference.booth_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_booth_categories ON conference.booth_categories;
CREATE POLICY svc_admin_booth_categories ON conference.booth_categories FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON conference.booth_categories FROM tixly_app;

-- conference.booths  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE conference.booths ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_booths ON conference.booths;
CREATE POLICY svc_admin_booths ON conference.booths FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON conference.booths FROM tixly_app;

-- conference.days  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE conference.days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_days ON conference.days;
CREATE POLICY svc_admin_days ON conference.days FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON conference.days FROM tixly_app;

-- conference.floor_maps  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE conference.floor_maps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_floor_maps ON conference.floor_maps;
CREATE POLICY svc_admin_floor_maps ON conference.floor_maps FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON conference.floor_maps FROM tixly_app;

-- conference.session_speakers  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE conference.session_speakers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_session_speakers ON conference.session_speakers;
CREATE POLICY svc_admin_session_speakers ON conference.session_speakers FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON conference.session_speakers FROM tixly_app;

-- conference.sessions  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE conference.sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_sessions ON conference.sessions;
CREATE POLICY svc_admin_sessions ON conference.sessions FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON conference.sessions FROM tixly_app;

-- conference.tracks  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE conference.tracks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_tracks ON conference.tracks;
CREATE POLICY svc_admin_tracks ON conference.tracks FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON conference.tracks FROM tixly_app;

-- cs.action_log  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE cs.action_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_action_log ON cs.action_log;
CREATE POLICY svc_admin_action_log ON cs.action_log FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON cs.action_log FROM tixly_app;

-- cs.notes  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE cs.notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_notes ON cs.notes;
CREATE POLICY svc_admin_notes ON cs.notes FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON cs.notes FROM tixly_app;

-- discovery_feed.feed_access_log  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE discovery_feed.feed_access_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_feed_access_log ON discovery_feed.feed_access_log;
CREATE POLICY svc_admin_feed_access_log ON discovery_feed.feed_access_log FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON discovery_feed.feed_access_log FROM tixly_app;

-- event_groups.bulk_edits  [TENANT] hromadné úpravy skupiny akcí
ALTER TABLE event_groups.bulk_edits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_bulk_edits ON event_groups.bulk_edits;
CREATE POLICY svc_admin_bulk_edits ON event_groups.bulk_edits FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_bulk_edits ON event_groups.bulk_edits;
CREATE POLICY owner_bulk_edits ON event_groups.bulk_edits FOR ALL
  USING (EXISTS (SELECT 1 FROM event_groups.groups g WHERE g.id = bulk_edits.group_id AND g.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM event_groups.groups g WHERE g.id = bulk_edits.group_id AND g.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON event_groups.bulk_edits FROM tixly_app;

-- event_groups.shares  [TENANT] sdílení skupin mezi pořadateli
ALTER TABLE event_groups.shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_shares ON event_groups.shares;
CREATE POLICY svc_admin_shares ON event_groups.shares FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_shares ON event_groups.shares;
CREATE POLICY owner_shares ON event_groups.shares FOR ALL
  USING (shares.owner_promoter_id = public.app_current_promoter_id())
  WITH CHECK (shares.owner_promoter_id = public.app_current_promoter_id());
DROP POLICY IF EXISTS read_shares ON event_groups.shares;
CREATE POLICY read_shares ON event_groups.shares FOR SELECT
  USING (shares.shared_with_promoter_id = public.app_current_promoter_id());
REVOKE TRUNCATE ON event_groups.shares FROM tixly_app;

-- eventim_export.export_log  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE eventim_export.export_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_export_log ON eventim_export.export_log;
CREATE POLICY svc_admin_export_log ON eventim_export.export_log FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON eventim_export.export_log FROM tixly_app;

-- identity.verified_persons  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE identity.verified_persons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_verified_persons ON identity.verified_persons;
CREATE POLICY svc_admin_verified_persons ON identity.verified_persons FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON identity.verified_persons FROM tixly_app;

-- lineups.artist_profiles  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE lineups.artist_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_artist_profiles ON lineups.artist_profiles;
CREATE POLICY svc_admin_artist_profiles ON lineups.artist_profiles FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON lineups.artist_profiles FROM tixly_app;

-- marketing.ad_auction_log  [TENANT] log aukce reklam (zobrazení u pořadatele); zápis jen servis (ads/click → servisní kontext)
ALTER TABLE marketing.ad_auction_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_ad_auction_log ON marketing.ad_auction_log;
CREATE POLICY svc_admin_ad_auction_log ON marketing.ad_auction_log FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS read_ad_auction_log ON marketing.ad_auction_log;
CREATE POLICY read_ad_auction_log ON marketing.ad_auction_log FOR SELECT
  USING (ad_auction_log.shown_on_promoter_id = public.app_current_promoter_id());
REVOKE TRUNCATE ON marketing.ad_auction_log FROM tixly_app;

-- marketing.editorial_articles  [SYSTEM] redakční články platformy (veřejný obsah)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON marketing.editorial_articles FROM tixly_app;
GRANT SELECT ON marketing.editorial_articles TO tixly_app;
GRANT INSERT, UPDATE ON marketing.editorial_articles TO tixly_app;

-- marketing.fan_bonus_issued  [TENANT] vydané fan bonusy (uživatel + akce); zápis jen servis
ALTER TABLE marketing.fan_bonus_issued ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_fan_bonus_issued ON marketing.fan_bonus_issued;
CREATE POLICY svc_admin_fan_bonus_issued ON marketing.fan_bonus_issued FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS read_fan_bonus_issued ON marketing.fan_bonus_issued;
CREATE POLICY read_fan_bonus_issued ON marketing.fan_bonus_issued FOR SELECT
  USING ((fan_bonus_issued.user_id = public.app_current_user_id() OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = fan_bonus_issued.event_id AND e.promoter_id = public.app_current_promoter_id())));
REVOKE TRUNCATE ON marketing.fan_bonus_issued FROM tixly_app;

-- marketing.promo_codes  [TENANT] promo kódy pořadatele (created_by_organizer_id) — řeší migrace 481 (V8)
ALTER TABLE marketing.promo_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_promo_codes ON marketing.promo_codes;
CREATE POLICY svc_admin_promo_codes ON marketing.promo_codes FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON marketing.promo_codes FROM tixly_app;

-- marketing.qr_scans  [TENANT] skeny QR kampaní pořadatele; zápis jen servis (qr/[slug] → servisní kontext)
ALTER TABLE marketing.qr_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_qr_scans ON marketing.qr_scans;
CREATE POLICY svc_admin_qr_scans ON marketing.qr_scans FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS read_qr_scans ON marketing.qr_scans;
CREATE POLICY read_qr_scans ON marketing.qr_scans FOR SELECT
  USING (EXISTS (SELECT 1 FROM marketing.qr_campaigns q JOIN catalog.events e ON e.id = q.event_id WHERE q.id = qr_scans.campaign_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON marketing.qr_scans FROM tixly_app;

-- marketing.transit_partners  [SYSTEM] číselník dopravních partnerů
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON marketing.transit_partners FROM tixly_app;
GRANT SELECT ON marketing.transit_partners TO tixly_app;

-- marketing.web_vitals  [SYSTEM] výkonová telemetrie stránek (bez osobních údajů)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON marketing.web_vitals FROM tixly_app;
GRANT SELECT ON marketing.web_vitals TO tixly_app;
GRANT INSERT ON marketing.web_vitals TO tixly_app;

-- monitoring.status_incidents  [SYSTEM] veřejné incidenty platformy
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON monitoring.status_incidents FROM tixly_app;
GRANT SELECT ON monitoring.status_incidents TO tixly_app;

-- monitoring.system_components  [SYSTEM] komponenty platformy (status)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON monitoring.system_components FROM tixly_app;
GRANT SELECT ON monitoring.system_components TO tixly_app;

-- orders.foyer_orders  [TENANT] objednávky z foyer (akce + objednávka kupce)
ALTER TABLE orders.foyer_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_foyer_orders ON orders.foyer_orders;
CREATE POLICY svc_admin_foyer_orders ON orders.foyer_orders FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_foyer_orders ON orders.foyer_orders;
CREATE POLICY owner_foyer_orders ON orders.foyer_orders FOR ALL
  USING ((EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = foyer_orders.event_id AND e.promoter_id = public.app_current_promoter_id()) OR EXISTS (SELECT 1 FROM orders.orders o WHERE o.id = foyer_orders.order_id)))
  WITH CHECK ((EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = foyer_orders.event_id AND e.promoter_id = public.app_current_promoter_id()) OR EXISTS (SELECT 1 FROM orders.orders o WHERE o.id = foyer_orders.order_id)));
REVOKE TRUNCATE ON orders.foyer_orders FROM tixly_app;

-- orders.gift_claims  [TENANT] uplatnění dárků (objednávka)
ALTER TABLE orders.gift_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_gift_claims ON orders.gift_claims;
CREATE POLICY svc_admin_gift_claims ON orders.gift_claims FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_gift_claims ON orders.gift_claims;
CREATE POLICY owner_gift_claims ON orders.gift_claims FOR ALL
  USING (EXISTS (SELECT 1 FROM orders.orders o WHERE o.id = gift_claims.order_id))
  WITH CHECK (EXISTS (SELECT 1 FROM orders.orders o WHERE o.id = gift_claims.order_id));
REVOKE TRUNCATE ON orders.gift_claims FROM tixly_app;

-- orders.lottery_entries  [TENANT] přihlášky do losování (e-maily) kampaně pořadatele
ALTER TABLE orders.lottery_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_lottery_entries ON orders.lottery_entries;
CREATE POLICY svc_admin_lottery_entries ON orders.lottery_entries FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_lottery_entries ON orders.lottery_entries;
CREATE POLICY owner_lottery_entries ON orders.lottery_entries FOR ALL
  USING (EXISTS (SELECT 1 FROM orders.lottery_campaigns c WHERE c.id = lottery_entries.campaign_id AND c.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM orders.lottery_campaigns c WHERE c.id = lottery_entries.campaign_id AND c.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON orders.lottery_entries FROM tixly_app;

-- orders.payment_installments  [TENANT] splátky objednávky (viditelnost dle objednávky)
ALTER TABLE orders.payment_installments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_payment_installments ON orders.payment_installments;
CREATE POLICY svc_admin_payment_installments ON orders.payment_installments FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_payment_installments ON orders.payment_installments;
CREATE POLICY owner_payment_installments ON orders.payment_installments FOR ALL
  USING (EXISTS (SELECT 1 FROM orders.order_payment_plans pp JOIN orders.orders o ON o.id = pp.order_id WHERE pp.id = payment_installments.order_payment_plan_id))
  WITH CHECK (EXISTS (SELECT 1 FROM orders.order_payment_plans pp JOIN orders.orders o ON o.id = pp.order_id WHERE pp.id = payment_installments.order_payment_plan_id));
REVOKE TRUNCATE ON orders.payment_installments FROM tixly_app;

-- orders.program_purchases  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE orders.program_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_program_purchases ON orders.program_purchases;
CREATE POLICY svc_admin_program_purchases ON orders.program_purchases FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON orders.program_purchases FROM tixly_app;

-- orders.reschedule_responses  [TENANT] odpovědi kupců na přesun akce
ALTER TABLE orders.reschedule_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_reschedule_responses ON orders.reschedule_responses;
CREATE POLICY svc_admin_reschedule_responses ON orders.reschedule_responses FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_reschedule_responses ON orders.reschedule_responses;
CREATE POLICY owner_reschedule_responses ON orders.reschedule_responses FOR ALL
  USING (EXISTS (SELECT 1 FROM orders.orders o WHERE o.id = reschedule_responses.order_id))
  WITH CHECK (EXISTS (SELECT 1 FROM orders.orders o WHERE o.id = reschedule_responses.order_id));
REVOKE TRUNCATE ON orders.reschedule_responses FROM tixly_app;

-- orders.reseller_sales  [TENANT] prodeje přes prodejce (objednávka)
ALTER TABLE orders.reseller_sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_reseller_sales ON orders.reseller_sales;
CREATE POLICY svc_admin_reseller_sales ON orders.reseller_sales FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_reseller_sales ON orders.reseller_sales;
CREATE POLICY owner_reseller_sales ON orders.reseller_sales FOR ALL
  USING (EXISTS (SELECT 1 FROM orders.orders o WHERE o.id = reseller_sales.order_id))
  WITH CHECK (EXISTS (SELECT 1 FROM orders.orders o WHERE o.id = reseller_sales.order_id));
REVOKE TRUNCATE ON orders.reseller_sales FROM tixly_app;

-- orders.season_pass_uses  [TENANT] použití permanentek na akci
ALTER TABLE orders.season_pass_uses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_season_pass_uses ON orders.season_pass_uses;
CREATE POLICY svc_admin_season_pass_uses ON orders.season_pass_uses FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_season_pass_uses ON orders.season_pass_uses;
CREATE POLICY owner_season_pass_uses ON orders.season_pass_uses FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = season_pass_uses.event_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = season_pass_uses.event_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON orders.season_pass_uses FROM tixly_app;

-- orders.season_passes  [TENANT] permanentky (objednávka, držitel)
ALTER TABLE orders.season_passes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_season_passes ON orders.season_passes;
CREATE POLICY svc_admin_season_passes ON orders.season_passes FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_season_passes ON orders.season_passes;
CREATE POLICY owner_season_passes ON orders.season_passes FOR ALL
  USING (EXISTS (SELECT 1 FROM orders.orders o WHERE o.id = season_passes.order_id))
  WITH CHECK (EXISTS (SELECT 1 FROM orders.orders o WHERE o.id = season_passes.order_id));
REVOKE TRUNCATE ON orders.season_passes FROM tixly_app;

-- orders.waiting_list  [TENANT] čekací listina akce (e-maily)
ALTER TABLE orders.waiting_list ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_waiting_list ON orders.waiting_list;
CREATE POLICY svc_admin_waiting_list ON orders.waiting_list FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_waiting_list ON orders.waiting_list;
CREATE POLICY owner_waiting_list ON orders.waiting_list FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = waiting_list.event_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = waiting_list.event_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON orders.waiting_list FROM tixly_app;

-- partner.partner_settlements  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE partner.partner_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_partner_settlements ON partner.partner_settlements;
CREATE POLICY svc_admin_partner_settlements ON partner.partner_settlements FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON partner.partner_settlements FROM tixly_app;

-- partner.partner_tokens  [LOCKED] tokeny partnerů (tajemství); jen admin/servis
ALTER TABLE partner.partner_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_partner_tokens ON partner.partner_tokens;
CREATE POLICY svc_admin_partner_tokens ON partner.partner_tokens FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON partner.partner_tokens FROM tixly_app;

-- platform.advance_payout_installments  [TENANT] splátky zálohové výplaty pořadatele
ALTER TABLE platform.advance_payout_installments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_advance_payout_installments ON platform.advance_payout_installments;
CREATE POLICY svc_admin_advance_payout_installments ON platform.advance_payout_installments FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_advance_payout_installments ON platform.advance_payout_installments;
CREATE POLICY owner_advance_payout_installments ON platform.advance_payout_installments FOR ALL
  USING (EXISTS (SELECT 1 FROM platform.advance_payout_schedules s WHERE s.id = advance_payout_installments.schedule_id AND s.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM platform.advance_payout_schedules s WHERE s.id = advance_payout_installments.schedule_id AND s.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON platform.advance_payout_installments FROM tixly_app;

-- platform.api_key_audit_log  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE platform.api_key_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_api_key_audit_log ON platform.api_key_audit_log;
CREATE POLICY svc_admin_api_key_audit_log ON platform.api_key_audit_log FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON platform.api_key_audit_log FROM tixly_app;

-- platform.config  [SYSTEM] globální konfigurace platformy
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.config FROM tixly_app;
GRANT SELECT ON platform.config TO tixly_app;

-- platform.currencies  [SYSTEM] číselník měn
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.currencies FROM tixly_app;
GRANT SELECT ON platform.currencies TO tixly_app;

-- platform.dashboard_widgets  [SYSTEM] katalog widgetů dashboardu
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.dashboard_widgets FROM tixly_app;
GRANT SELECT ON platform.dashboard_widgets TO tixly_app;

-- platform.distribution_access_tokens  [LOCKED] přístupové tokeny distribučních partnerů (tajemství); NOCTX cesty → servisní kontext
ALTER TABLE platform.distribution_access_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_distribution_access_tokens ON platform.distribution_access_tokens;
CREATE POLICY svc_admin_distribution_access_tokens ON platform.distribution_access_tokens FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON platform.distribution_access_tokens FROM tixly_app;

-- platform.distribution_partners  [LOCKED] distribuční partneři (client_secret_hash); NOCTX cesty → servisní kontext
ALTER TABLE platform.distribution_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_distribution_partners ON platform.distribution_partners;
CREATE POLICY svc_admin_distribution_partners ON platform.distribution_partners FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON platform.distribution_partners FROM tixly_app;

-- platform.exchange_rates  [SYSTEM] kurzy měn
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.exchange_rates FROM tixly_app;
GRANT SELECT ON platform.exchange_rates TO tixly_app;

-- platform.incident_updates  [SYSTEM] veřejná status stránka platformy
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.incident_updates FROM tixly_app;
GRANT SELECT ON platform.incident_updates TO tixly_app;
GRANT INSERT ON platform.incident_updates TO tixly_app;

-- platform.incidents  [SYSTEM] veřejná status stránka platformy
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.incidents FROM tixly_app;
GRANT SELECT ON platform.incidents TO tixly_app;
GRANT INSERT, UPDATE, DELETE ON platform.incidents TO tixly_app;

-- platform.publish_sold_notifications  [TENANT] notifikace prodeje akce
ALTER TABLE platform.publish_sold_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_publish_sold_notifications ON platform.publish_sold_notifications;
CREATE POLICY svc_admin_publish_sold_notifications ON platform.publish_sold_notifications FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_publish_sold_notifications ON platform.publish_sold_notifications;
CREATE POLICY owner_publish_sold_notifications ON platform.publish_sold_notifications FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = publish_sold_notifications.event_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = publish_sold_notifications.event_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON platform.publish_sold_notifications FROM tixly_app;

-- platform.purchase_agents  [USER] nákupní AI agenti uživatele
ALTER TABLE platform.purchase_agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_purchase_agents ON platform.purchase_agents;
CREATE POLICY svc_admin_purchase_agents ON platform.purchase_agents FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_purchase_agents ON platform.purchase_agents;
CREATE POLICY owner_purchase_agents ON platform.purchase_agents FOR ALL
  USING (purchase_agents.owner_user_id = public.app_current_user_id())
  WITH CHECK (purchase_agents.owner_user_id = public.app_current_user_id());
REVOKE TRUNCATE ON platform.purchase_agents FROM tixly_app;

-- platform.reseller_partners  [TENANT] prodejní partneři (password_hash, api_key); čtení pořadatelem (distribuce), zápis admin/servis; reseller/auth → servisní kontext
ALTER TABLE platform.reseller_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_reseller_partners ON platform.reseller_partners;
CREATE POLICY svc_admin_reseller_partners ON platform.reseller_partners FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS read_reseller_partners ON platform.reseller_partners;
CREATE POLICY read_reseller_partners ON platform.reseller_partners FOR SELECT
  USING (public.app_current_promoter_id() IS NOT NULL);
REVOKE TRUNCATE ON platform.reseller_partners FROM tixly_app;

-- platform.staff_permissions  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE platform.staff_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_staff_permissions ON platform.staff_permissions;
CREATE POLICY svc_admin_staff_permissions ON platform.staff_permissions FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON platform.staff_permissions FROM tixly_app;

-- platform.staff_roles  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE platform.staff_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_staff_roles ON platform.staff_roles;
CREATE POLICY svc_admin_staff_roles ON platform.staff_roles FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON platform.staff_roles FROM tixly_app;

-- platform.webhook_deliveries  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE platform.webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_webhook_deliveries ON platform.webhook_deliveries;
CREATE POLICY svc_admin_webhook_deliveries ON platform.webhook_deliveries FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON platform.webhook_deliveries FROM tixly_app;

-- pos.pos_reconciliations  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE pos.pos_reconciliations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_pos_reconciliations ON pos.pos_reconciliations;
CREATE POLICY svc_admin_pos_reconciliations ON pos.pos_reconciliations FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON pos.pos_reconciliations FROM tixly_app;

-- pos.tap_to_pay_transactions  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE pos.tap_to_pay_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_tap_to_pay_transactions ON pos.tap_to_pay_transactions;
CREATE POLICY svc_admin_tap_to_pay_transactions ON pos.tap_to_pay_transactions FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON pos.tap_to_pay_transactions FROM tixly_app;

-- pricing.price_adjustment_log  [TENANT] log úprav cen akce
ALTER TABLE pricing.price_adjustment_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_price_adjustment_log ON pricing.price_adjustment_log;
CREATE POLICY svc_admin_price_adjustment_log ON pricing.price_adjustment_log FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_price_adjustment_log ON pricing.price_adjustment_log;
CREATE POLICY owner_price_adjustment_log ON pricing.price_adjustment_log FOR ALL
  USING (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = price_adjustment_log.event_id AND e.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = price_adjustment_log.event_id AND e.promoter_id = public.app_current_promoter_id()));
REVOKE TRUNCATE ON pricing.price_adjustment_log FROM tixly_app;

-- referral.clicks  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE referral.clicks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_clicks ON referral.clicks;
CREATE POLICY svc_admin_clicks ON referral.clicks FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON referral.clicks FROM tixly_app;

-- resale.resale_rules_overrides  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE resale.resale_rules_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_resale_rules_overrides ON resale.resale_rules_overrides;
CREATE POLICY svc_admin_resale_rules_overrides ON resale.resale_rules_overrides FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON resale.resale_rules_overrides FROM tixly_app;

-- reservations.availability_overrides  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE reservations.availability_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_availability_overrides ON reservations.availability_overrides;
CREATE POLICY svc_admin_availability_overrides ON reservations.availability_overrides FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON reservations.availability_overrides FROM tixly_app;

-- reservations.availability_rules  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE reservations.availability_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_availability_rules ON reservations.availability_rules;
CREATE POLICY svc_admin_availability_rules ON reservations.availability_rules FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON reservations.availability_rules FROM tixly_app;

-- reservations.branch_closures  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE reservations.branch_closures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_branch_closures ON reservations.branch_closures;
CREATE POLICY svc_admin_branch_closures ON reservations.branch_closures FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON reservations.branch_closures FROM tixly_app;

-- reservations.branch_hours  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE reservations.branch_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_branch_hours ON reservations.branch_hours;
CREATE POLICY svc_admin_branch_hours ON reservations.branch_hours FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON reservations.branch_hours FROM tixly_app;

-- reservations.branch_service_availability  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE reservations.branch_service_availability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_branch_service_availability ON reservations.branch_service_availability;
CREATE POLICY svc_admin_branch_service_availability ON reservations.branch_service_availability FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON reservations.branch_service_availability FROM tixly_app;

-- reservations.branch_settings  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE reservations.branch_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_branch_settings ON reservations.branch_settings;
CREATE POLICY svc_admin_branch_settings ON reservations.branch_settings FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON reservations.branch_settings FROM tixly_app;

-- reservations.package_credit_balances  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE reservations.package_credit_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_package_credit_balances ON reservations.package_credit_balances;
CREATE POLICY svc_admin_package_credit_balances ON reservations.package_credit_balances FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON reservations.package_credit_balances FROM tixly_app;

-- reservations.package_usage  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE reservations.package_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_package_usage ON reservations.package_usage;
CREATE POLICY svc_admin_package_usage ON reservations.package_usage FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON reservations.package_usage FROM tixly_app;

-- reservations.rule_actions  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE reservations.rule_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_rule_actions ON reservations.rule_actions;
CREATE POLICY svc_admin_rule_actions ON reservations.rule_actions FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON reservations.rule_actions FROM tixly_app;

-- reservations.rule_conditions  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE reservations.rule_conditions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_rule_conditions ON reservations.rule_conditions;
CREATE POLICY svc_admin_rule_conditions ON reservations.rule_conditions FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON reservations.rule_conditions FROM tixly_app;

-- reservations.service_addons  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE reservations.service_addons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_service_addons ON reservations.service_addons;
CREATE POLICY svc_admin_service_addons ON reservations.service_addons FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON reservations.service_addons FROM tixly_app;

-- reservations.service_pricing_rules  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE reservations.service_pricing_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_service_pricing_rules ON reservations.service_pricing_rules;
CREATE POLICY svc_admin_service_pricing_rules ON reservations.service_pricing_rules FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON reservations.service_pricing_rules FROM tixly_app;

-- reservations.service_resources  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE reservations.service_resources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_service_resources ON reservations.service_resources;
CREATE POLICY svc_admin_service_resources ON reservations.service_resources FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON reservations.service_resources FROM tixly_app;

-- reservations.slots  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE reservations.slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_slots ON reservations.slots;
CREATE POLICY svc_admin_slots ON reservations.slots FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON reservations.slots FROM tixly_app;

-- resources.resource_hub  [SYSTEM] veřejný obsah (návody, ke stažení)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON resources.resource_hub FROM tixly_app;
GRANT SELECT ON resources.resource_hub TO tixly_app;

-- retailer.settlements  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE retailer.settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_settlements ON retailer.settlements;
CREATE POLICY svc_admin_settlements ON retailer.settlements FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON retailer.settlements FROM tixly_app;

-- rfid.rfid_taps  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE rfid.rfid_taps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_rfid_taps ON rfid.rfid_taps;
CREATE POLICY svc_admin_rfid_taps ON rfid.rfid_taps FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON rfid.rfid_taps FROM tixly_app;

-- rfid.rfid_top_ups  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE rfid.rfid_top_ups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_rfid_top_ups ON rfid.rfid_top_ups;
CREATE POLICY svc_admin_rfid_top_ups ON rfid.rfid_top_ups FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON rfid.rfid_top_ups FROM tixly_app;

-- risk.fraud_reviews  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE risk.fraud_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_fraud_reviews ON risk.fraud_reviews;
CREATE POLICY svc_admin_fraud_reviews ON risk.fraud_reviews FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON risk.fraud_reviews FROM tixly_app;

-- risk.fraud_rules  [SYSTEM] globální pravidla antifraud
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON risk.fraud_rules FROM tixly_app;
GRANT SELECT ON risk.fraud_rules TO tixly_app;

-- risk.velocity_limits  [SYSTEM] globální limity rychlosti
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON risk.velocity_limits FROM tixly_app;
GRANT SELECT ON risk.velocity_limits TO tixly_app;

-- social_graph.friend_requests  [USER] žádosti o přátelství
ALTER TABLE social_graph.friend_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_friend_requests ON social_graph.friend_requests;
CREATE POLICY svc_admin_friend_requests ON social_graph.friend_requests FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_friend_requests ON social_graph.friend_requests;
CREATE POLICY owner_friend_requests ON social_graph.friend_requests FOR ALL
  USING ((friend_requests.from_user_id = public.app_current_user_id() OR friend_requests.to_user_id = public.app_current_user_id()))
  WITH CHECK ((friend_requests.from_user_id = public.app_current_user_id() OR friend_requests.to_user_id = public.app_current_user_id()));
REVOKE TRUNCATE ON social_graph.friend_requests FROM tixly_app;

-- social_graph.friendships  [USER] přátelství uživatelů
ALTER TABLE social_graph.friendships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_friendships ON social_graph.friendships;
CREATE POLICY svc_admin_friendships ON social_graph.friendships FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_friendships ON social_graph.friendships;
CREATE POLICY owner_friendships ON social_graph.friendships FOR ALL
  USING ((friendships.user_a = public.app_current_user_id() OR friendships.user_b = public.app_current_user_id()))
  WITH CHECK ((friendships.user_a = public.app_current_user_id() OR friendships.user_b = public.app_current_user_id()));
REVOKE TRUNCATE ON social_graph.friendships FROM tixly_app;

-- support_chat.chat_messages  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE support_chat.chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_chat_messages ON support_chat.chat_messages;
CREATE POLICY svc_admin_chat_messages ON support_chat.chat_messages FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON support_chat.chat_messages FROM tixly_app;

-- support_chat.session_feedback  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE support_chat.session_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_session_feedback ON support_chat.session_feedback;
CREATE POLICY svc_admin_session_feedback ON support_chat.session_feedback FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON support_chat.session_feedback FROM tixly_app;

-- tickets.access_token_log  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE tickets.access_token_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_access_token_log ON tickets.access_token_log;
CREATE POLICY svc_admin_access_token_log ON tickets.access_token_log FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON tickets.access_token_log FROM tixly_app;

-- tickets.wristband_transactions  [TENANT] transakce náramků (viditelnost dle náramku → vstupenka)
ALTER TABLE tickets.wristband_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_wristband_transactions ON tickets.wristband_transactions;
CREATE POLICY svc_admin_wristband_transactions ON tickets.wristband_transactions FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
DROP POLICY IF EXISTS owner_wristband_transactions ON tickets.wristband_transactions;
CREATE POLICY owner_wristband_transactions ON tickets.wristband_transactions FOR ALL
  USING (EXISTS (SELECT 1 FROM tickets.wristbands w WHERE w.uid = wristband_transactions.wristband_uid))
  WITH CHECK (EXISTS (SELECT 1 FROM tickets.wristbands w WHERE w.uid = wristband_transactions.wristband_uid));
REVOKE TRUNCATE ON tickets.wristband_transactions FROM tixly_app;

-- tours.series_metrics  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE tours.series_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_series_metrics ON tours.series_metrics;
CREATE POLICY svc_admin_series_metrics ON tours.series_metrics FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON tours.series_metrics FROM tixly_app;

-- tours.shared_seat_maps  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE tours.shared_seat_maps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_shared_seat_maps ON tours.shared_seat_maps;
CREATE POLICY svc_admin_shared_seat_maps ON tours.shared_seat_maps FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON tours.shared_seat_maps FROM tixly_app;

-- venues.court_bookings  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.court_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_court_bookings ON venues.court_bookings;
CREATE POLICY svc_admin_court_bookings ON venues.court_bookings FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.court_bookings FROM tixly_app;

-- venues.courts  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.courts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_courts ON venues.courts;
CREATE POLICY svc_admin_courts ON venues.courts FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.courts FROM tixly_app;

-- venues.daily_capacity  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.daily_capacity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_daily_capacity ON venues.daily_capacity;
CREATE POLICY svc_admin_daily_capacity ON venues.daily_capacity FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.daily_capacity FROM tixly_app;

-- venues.daily_tickets  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.daily_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_daily_tickets ON venues.daily_tickets;
CREATE POLICY svc_admin_daily_tickets ON venues.daily_tickets FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.daily_tickets FROM tixly_app;

-- venues.entry_slots  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.entry_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_entry_slots ON venues.entry_slots;
CREATE POLICY svc_admin_entry_slots ON venues.entry_slots FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.entry_slots FROM tixly_app;

-- venues.escape_rooms  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.escape_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_escape_rooms ON venues.escape_rooms;
CREATE POLICY svc_admin_escape_rooms ON venues.escape_rooms FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.escape_rooms FROM tixly_app;

-- venues.facility_zones  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.facility_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_facility_zones ON venues.facility_zones;
CREATE POLICY svc_admin_facility_zones ON venues.facility_zones FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.facility_zones FROM tixly_app;

-- venues.game_results  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.game_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_game_results ON venues.game_results;
CREATE POLICY svc_admin_game_results ON venues.game_results FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.game_results FROM tixly_app;

-- venues.guest_passes  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.guest_passes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_guest_passes ON venues.guest_passes;
CREATE POLICY svc_admin_guest_passes ON venues.guest_passes FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.guest_passes FROM tixly_app;

-- venues.leaderboard_entries  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.leaderboard_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_leaderboard_entries ON venues.leaderboard_entries;
CREATE POLICY svc_admin_leaderboard_entries ON venues.leaderboard_entries FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.leaderboard_entries FROM tixly_app;

-- venues.lift_scans  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.lift_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_lift_scans ON venues.lift_scans;
CREATE POLICY svc_admin_lift_scans ON venues.lift_scans FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.lift_scans FROM tixly_app;

-- venues.locker_reservations  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.locker_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_locker_reservations ON venues.locker_reservations;
CREATE POLICY svc_admin_locker_reservations ON venues.locker_reservations FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.locker_reservations FROM tixly_app;

-- venues.ski_pass_types  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.ski_pass_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_ski_pass_types ON venues.ski_pass_types;
CREATE POLICY svc_admin_ski_pass_types ON venues.ski_pass_types FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.ski_pass_types FROM tixly_app;

-- venues.ski_school_sessions  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.ski_school_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_ski_school_sessions ON venues.ski_school_sessions;
CREATE POLICY svc_admin_ski_school_sessions ON venues.ski_school_sessions FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.ski_school_sessions FROM tixly_app;

-- venues.ticket_types  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.ticket_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_ticket_types ON venues.ticket_types;
CREATE POLICY svc_admin_ticket_types ON venues.ticket_types FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.ticket_types FROM tixly_app;

-- venues.venue_zones  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.venue_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_venue_zones ON venues.venue_zones;
CREATE POLICY svc_admin_venue_zones ON venues.venue_zones FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.venue_zones FROM tixly_app;

-- venues.zone_access  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE venues.zone_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_zone_access ON venues.zone_access;
CREATE POLICY svc_admin_zone_access ON venues.zone_access FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON venues.zone_access FROM tixly_app;

-- virtual_venue.seat_previews  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE virtual_venue.seat_previews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_seat_previews ON virtual_venue.seat_previews;
CREATE POLICY svc_admin_seat_previews ON virtual_venue.seat_previews FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON virtual_venue.seat_previews FROM tixly_app;

-- virtual_venue.section_panoramas  [LOCKED] data tenantu/uživatele bez použití v kódu
ALTER TABLE virtual_venue.section_panoramas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_admin_section_panoramas ON virtual_venue.section_panoramas;
CREATE POLICY svc_admin_section_panoramas ON virtual_venue.section_panoramas FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());
REVOKE TRUNCATE ON virtual_venue.section_panoramas FROM tixly_app;

-- TRUNCATE obchází RLS — tixly_app ho nepoužívá (grep src: 0 výskytů) → odebrat všude.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
              AND has_table_privilege('tixly_app', c.oid, 'TRUNCATE')
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON %I.%I FROM tixly_app', r.nspname, r.relname);
  END LOOP;
END $$;

COMMIT;
