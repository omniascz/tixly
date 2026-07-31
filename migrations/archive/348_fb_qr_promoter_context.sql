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
