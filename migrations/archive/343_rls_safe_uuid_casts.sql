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
