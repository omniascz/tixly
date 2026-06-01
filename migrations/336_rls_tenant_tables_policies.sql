-- RLS Fáze 2 — policy review: 30 RLS-off tabulek s tenant sloupcem (user/seller/buyer).
--
-- Pod enforce by tyto držely user-scoped data nechráněně. Šablony:
--   T1 user+event   : service/admin/vlastník/promotér-akce (přes event_id → events.promoter_id)
--   T2 user+order   : service/admin/vlastník/promotér-akce (přes order_id → orders → events)
--   T3 user-only    : service/admin/vlastník (bez promotér přístupu)
-- event_reviews/event_rsvps navíc public-read (veřejné recenze / FOMO counts).
-- FOR ALL bez WITH CHECK → INSERT check dědí USING výraz.

-- ============ T1: user + event→promotér ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'analytics.funnel_events','attribution.touch_points','audit.bot_detections',
    'marketing.verified_fan_requests','notifications.push_notifications',
    'orders.abandoned_carts','orders.buyer_event_purchases','platform.queue_tokens',
    'resale.resale_watchlist','risk.device_fingerprints','seat_upgrades.upgrade_requests',
    'social_graph.activities','sport.package_game_selections','support_chat.chat_sessions',
    'tickets.stream_token_log','venue_features.friend_locations'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS p_scope ON %s', t);
    EXECUTE format($f$
      CREATE POLICY p_scope ON %1$s FOR ALL USING (
        app_is_service() OR app_is_platform_admin()
        OR user_id = app_current_user_id()
        OR EXISTS (SELECT 1 FROM catalog.events e
                    WHERE e.id = %1$s.event_id AND e.promoter_id = app_current_promoter_id())
      )$f$, t);
  END LOOP;
END $$;

-- waiting_room.queue_entries — user_id je TEXT (ne uuid) → cast
ALTER TABLE waiting_room.queue_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_scope ON waiting_room.queue_entries;
CREATE POLICY p_scope ON waiting_room.queue_entries FOR ALL USING (
  app_is_service() OR app_is_platform_admin()
  OR user_id = app_current_user_id()::text
  OR EXISTS (SELECT 1 FROM catalog.events e
              WHERE e.id = queue_entries.event_id AND e.promoter_id = app_current_promoter_id())
);

-- ============ T2: user + order→event→promotér ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'attribution.conversions','benefit_payments.payment_sessions','conference.pass_activations',
    'marketing.promo_code_usages','payments.paypal_orders','tickets.cross_pass_memberships',
    'venues.ski_pass_activations','subscriptions.holders'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS p_scope ON %s', t);
    EXECUTE format($f$
      CREATE POLICY p_scope ON %1$s FOR ALL USING (
        app_is_service() OR app_is_platform_admin()
        OR user_id = app_current_user_id()
        OR EXISTS (SELECT 1 FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
                    WHERE o.id = %1$s.order_id AND e.promoter_id = app_current_promoter_id())
      )$f$, t);
  END LOOP;
END $$;

-- ============ T3: user-only (bez promotér přístupu) ============
-- resale.seller_payouts (seller_id)
ALTER TABLE resale.seller_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_scope ON resale.seller_payouts;
CREATE POLICY p_scope ON resale.seller_payouts FOR ALL USING (
  app_is_service() OR app_is_platform_admin() OR seller_id = app_current_user_id()
);
-- surveys.survey_responses (buyer_id)
ALTER TABLE surveys.survey_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_scope ON surveys.survey_responses;
CREATE POLICY p_scope ON surveys.survey_responses FOR ALL USING (
  app_is_service() OR app_is_platform_admin() OR buyer_id = app_current_user_id()
);
-- tickets.access_tokens (holder_user_id) — magic-link tokeny, čtou se ve service (token=auth)
ALTER TABLE tickets.access_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_scope ON tickets.access_tokens;
CREATE POLICY p_scope ON tickets.access_tokens FOR ALL USING (
  app_is_service() OR app_is_platform_admin() OR holder_user_id = app_current_user_id()
);

-- ============ SPECIÁL: event_reviews (T1 + public-read) ============
ALTER TABLE marketing.event_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_scope ON marketing.event_reviews;
CREATE POLICY p_scope ON marketing.event_reviews FOR ALL USING (
  app_is_service() OR app_is_platform_admin()
  OR user_id = app_current_user_id()
  OR EXISTS (SELECT 1 FROM catalog.events e
              WHERE e.id = event_reviews.event_id AND e.promoter_id = app_current_promoter_id())
  OR (is_public = true AND hidden_by_admin = false)   -- veřejný výpis recenzí
);

-- ============ SPECIÁL: event_rsvps (T1 + public FOMO counts) ============
ALTER TABLE marketing.event_rsvps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_scope ON marketing.event_rsvps;
CREATE POLICY p_scope ON marketing.event_rsvps FOR ALL USING (
  app_is_service() OR app_is_platform_admin()
  OR user_id = app_current_user_id()
  OR EXISTS (SELECT 1 FROM catalog.events e
              WHERE e.id = event_rsvps.event_id AND e.promoter_id = app_current_promoter_id())
  OR is_public = true   -- veřejné going/interested counts
);
