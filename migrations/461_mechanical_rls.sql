--
-- 461_mechanical_rls.sql — RLS na 19 tabulek s primym tenant sloupcem
--
-- VYGENEROVANO skriptem scripts/gen-461-mechanical-rls.mjs z KATALOGU.
-- Needituj rucne — pust generator znovu.
--
-- ── Co to resi (FINDINGS §96) ────────────────────────────────────────────────
-- 189 tabulek z 600 stalo uplne mimo model izolace; 24 z nich neslo tenant data.
-- Unik byl DOLOZEN merenim: promoter A pod tixly_app cetl radek promotera B
-- z catalog.productions. Izolaci drzel jedine WHERE v aplikaci — jedina vrstva.
--
-- Tohle je 19 MECHANICKYCH z tech 24: tenant sloupec je na radku primo a je
-- NOT NULL. Zbylych 5 (b2b_transactions, eudi_verifications, films, sport_teams,
-- fan_bonus_issued) ceka na rozhodnuti — vazba pres JOIN nebo NULLABLE sloupec.
--
-- ── Tvar ─────────────────────────────────────────────────────────────────────
-- Doslova p_orders_scope ze §81:
--   app_is_platform_admin() OR app_is_service() OR <sloupec> = <helper>()
-- app_is_service() tam MUSI byt — checkout, cron a webhooky na cast techto
-- tabulek sahaji a bezi v servisnim kontextu.
--
-- ── FORCE ROW LEVEL SECURITY: ZAMERNE NE ─────────────────────────────────────
-- FORCE podrobuje RLS i VLASTNIKA tabulky. Aplikace se pripojuje jako tixly_app,
-- ktery vlastnikem NENI, takze se ho RLS tyka i bez FORCE. Baseline nema FORCE
-- ani na jedne z 600 tabulek — zavest ho tady by 20 tabulek odlisilo od zbytku
-- a rozbilo migracni/servisni skripty bezici pod ownerem.
--
-- ── Vykon ────────────────────────────────────────────────────────────────────
-- Predikat je rovnost na indexovany sloupec; helper je STABLE, takze se
-- vyhodnoti jednou na dotaz. Zadna korelace = §53 se netyka. 4 z techto tabulek
-- lezi v horke ceste (checkout/scan/webhooks), cena je fakticky nula.
--

BEGIN;

-- analytics.yield_rules :: promoter_id (NOT NULL, primy)
ALTER TABLE analytics.yield_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_yield_rules_scope ON analytics.yield_rules;
CREATE POLICY p_yield_rules_scope ON analytics.yield_rules
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- brands.event_partnerships :: promoter_id (NOT NULL, primy)
ALTER TABLE brands.event_partnerships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_event_partnerships_scope ON brands.event_partnerships;
CREATE POLICY p_event_partnerships_scope ON brands.event_partnerships
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- catalog.event_reschedules :: promoter_id (NOT NULL, primy)
ALTER TABLE catalog.event_reschedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_event_reschedules_scope ON catalog.event_reschedules;
CREATE POLICY p_event_reschedules_scope ON catalog.event_reschedules
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- catalog.productions :: promoter_id (NOT NULL, primy)
ALTER TABLE catalog.productions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_productions_scope ON catalog.productions;
CREATE POLICY p_productions_scope ON catalog.productions
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- catalog.season_pass_products :: promoter_id (NOT NULL, primy)
ALTER TABLE catalog.season_pass_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_season_pass_products_scope ON catalog.season_pass_products;
CREATE POLICY p_season_pass_products_scope ON catalog.season_pass_products
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- communications.broadcasts :: promoter_id (NOT NULL, primy)
ALTER TABLE communications.broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_broadcasts_scope ON communications.broadcasts;
CREATE POLICY p_broadcasts_scope ON communications.broadcasts
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- communications.emergency_announcements :: promoter_id (NOT NULL, primy)
ALTER TABLE communications.emergency_announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_emergency_announcements_scope ON communications.emergency_announcements;
CREATE POLICY p_emergency_announcements_scope ON communications.emergency_announcements
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- orders.guestlist_entries :: promoter_id (NOT NULL, primy)
ALTER TABLE orders.guestlist_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_guestlist_entries_scope ON orders.guestlist_entries;
CREATE POLICY p_guestlist_entries_scope ON orders.guestlist_entries
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- orders.lottery_campaigns :: promoter_id (NOT NULL, primy)
ALTER TABLE orders.lottery_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lottery_campaigns_scope ON orders.lottery_campaigns;
CREATE POLICY p_lottery_campaigns_scope ON orders.lottery_campaigns
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- orders.phone_orders :: promoter_id (NOT NULL, primy)
ALTER TABLE orders.phone_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_phone_orders_scope ON orders.phone_orders;
CREATE POLICY p_phone_orders_scope ON orders.phone_orders
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- orders.press_accreditations :: promoter_id (NOT NULL, primy)
ALTER TABLE orders.press_accreditations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_press_accreditations_scope ON orders.press_accreditations;
CREATE POLICY p_press_accreditations_scope ON orders.press_accreditations
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- orders.school_bookings :: promoter_id (NOT NULL, primy)
ALTER TABLE orders.school_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_school_bookings_scope ON orders.school_bookings;
CREATE POLICY p_school_bookings_scope ON orders.school_bookings
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- platform.import_jobs :: promoter_id (NOT NULL, primy)
ALTER TABLE platform.import_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_import_jobs_scope ON platform.import_jobs;
CREATE POLICY p_import_jobs_scope ON platform.import_jobs
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- platform.promoter_contacts :: promoter_id (NOT NULL, primy)
ALTER TABLE platform.promoter_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_promoter_contacts_scope ON platform.promoter_contacts;
CREATE POLICY p_promoter_contacts_scope ON platform.promoter_contacts
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- platform.promoter_onboarding :: promoter_id (NOT NULL, primy)
ALTER TABLE platform.promoter_onboarding ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_promoter_onboarding_scope ON platform.promoter_onboarding;
CREATE POLICY p_promoter_onboarding_scope ON platform.promoter_onboarding
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- pricing.dynamic_pricing_rules :: promoter_id (NOT NULL, primy)
ALTER TABLE pricing.dynamic_pricing_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_dynamic_pricing_rules_scope ON pricing.dynamic_pricing_rules;
CREATE POLICY p_dynamic_pricing_rules_scope ON pricing.dynamic_pricing_rules
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- identity.fan_profiles :: user_id (NOT NULL, primy)
ALTER TABLE identity.fan_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_fan_profiles_scope ON identity.fan_profiles;
CREATE POLICY p_fan_profiles_scope ON identity.fan_profiles
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR user_id = public.app_current_user_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR user_id = public.app_current_user_id());

-- notifications.push_sent_log :: user_id (NOT NULL, primy)
ALTER TABLE notifications.push_sent_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_push_sent_log_scope ON notifications.push_sent_log;
CREATE POLICY p_push_sent_log_scope ON notifications.push_sent_log
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR user_id = public.app_current_user_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR user_id = public.app_current_user_id());

-- platform.agent_mandates :: user_id (NOT NULL, primy)
ALTER TABLE platform.agent_mandates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_agent_mandates_scope ON platform.agent_mandates;
CREATE POLICY p_agent_mandates_scope ON platform.agent_mandates
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR user_id = public.app_current_user_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR user_id = public.app_current_user_id());

COMMIT;
