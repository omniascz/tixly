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
