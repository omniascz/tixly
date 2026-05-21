-- 308_tm_parity_tm7_complete.sql
-- TM Parity Fáze TM7 — finální 10 features (P0 + P1):
-- 1. Postponed event status + flow
-- 2. Will Call mode (vyzvednutí na pokladně)
-- 3. Reusable event templates
-- 4. Pixely placement (Meta/Google tracking)
-- 5. Customizable dashboards (drag&drop widget config)
-- 6. Enhanced Wallet Content Modules
-- 7. Money-back guarantee labeling (resale)
-- 8. Face Value Exchange labels (UI flag)
-- 9. GA Best Available sort
-- 10. Live ticket animations (config)

BEGIN;

-- ============================================================
-- 1. Postponed event status
-- ============================================================
-- Existing events.status check — pojďme rozšířit
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS postponed_at timestamptz,
  ADD COLUMN IF NOT EXISTS postponed_reason text,
  ADD COLUMN IF NOT EXISTS expected_decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS original_date_start timestamptz,
  ADD COLUMN IF NOT EXISTS rescheduled_to_date timestamptz;

COMMENT ON COLUMN catalog.events.postponed_at IS
  'Pokud event odložen (nezrušen). Tickets zůstávají platné. Original date v original_date_start.';

CREATE INDEX IF NOT EXISTS idx_events_postponed
  ON catalog.events(postponed_at) WHERE postponed_at IS NOT NULL;

-- ============================================================
-- 2. Will Call mode (delivery option per ticket_type / event)
-- ============================================================
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS delivery_methods text[] NOT NULL DEFAULT ARRAY['mobile', 'pdf'],
  ADD COLUMN IF NOT EXISTS will_call_pickup_location text,
  ADD COLUMN IF NOT EXISTS will_call_pickup_hours text,
  ADD COLUMN IF NOT EXISTS will_call_id_required boolean NOT NULL DEFAULT true;

-- Per-order chosen delivery method
ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS delivery_method text DEFAULT 'mobile'
    CHECK (delivery_method IN ('mobile', 'pdf', 'will_call', 'wallet')),
  ADD COLUMN IF NOT EXISTS will_call_picked_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS will_call_picked_up_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL;

-- ============================================================
-- 3. Reusable Event Templates
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog.event_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  -- Template type
  template_type   text NOT NULL CHECK (template_type IN
                    ('full_event', 'presale_setup', 'vip_package', 'discount_bundle', 'pricing_tiers')),
  -- Serialized template content (ticket_types, promo_codes, group_discounts, ...)
  template_data   jsonb NOT NULL,
  preview_image_url text,
  usage_count     integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_templates_promoter
  ON catalog.event_templates(promoter_id, template_type) WHERE is_active = true;

COMMENT ON TABLE catalog.event_templates IS
  'TM reusable templates: presales, VIP packages, special offers. Applicable na více akcí.';

-- ============================================================
-- 4. Pixely (tracking pixels)
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing.tracking_pixels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES catalog.events(id) ON DELETE CASCADE,
  -- Pokud event_id NULL = promoter-wide pixel (všechny eventy)
  platform        text NOT NULL CHECK (platform IN
                    ('meta', 'google_ads', 'google_analytics', 'tiktok', 'linkedin', 'twitter', 'custom')),
  pixel_id        text NOT NULL,             -- Meta Pixel ID, GA Measurement ID, atd.
  config          jsonb,                     -- platform-specific (eg. Meta access_token)
  events_tracked  text[] NOT NULL DEFAULT ARRAY['ViewContent', 'AddToCart', 'Purchase'],
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pixels_event
  ON marketing.tracking_pixels(event_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_pixels_promoter
  ON marketing.tracking_pixels(promoter_id) WHERE event_id IS NULL AND is_active = true;

-- ============================================================
-- 5. Customizable dashboards (per-user widget layout)
-- ============================================================
CREATE TABLE IF NOT EXISTS platform.dashboard_layouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  promoter_id     uuid REFERENCES platform.promoters(id) ON DELETE CASCADE,
  dashboard_key   text NOT NULL,             -- 'main', 'event_detail', 'finance', ...
  -- Widget layout: [{ widget: 'sales_today', position: { x: 0, y: 0, w: 3, h: 2 } }, ...]
  layout_data     jsonb NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dashboard_key)
);

COMMENT ON TABLE platform.dashboard_layouts IS
  'TM customizable dashboards. Per-user widget config. Layout: react-grid-layout format.';

-- Catalog of available widgets (master-curated)
CREATE TABLE IF NOT EXISTS platform.dashboard_widgets (
  id              text PRIMARY KEY,            -- 'sales_today', 'live_feed', 'pricemaster', ...
  title           text NOT NULL,
  description     text,
  category        text,
  default_width   integer NOT NULL DEFAULT 3,
  default_height  integer NOT NULL DEFAULT 2,
  min_width       integer NOT NULL DEFAULT 2,
  min_height      integer NOT NULL DEFAULT 1,
  data_endpoint   text,                        -- API endpoint pro widget data
  refresh_seconds integer NOT NULL DEFAULT 60,
  is_active       boolean NOT NULL DEFAULT true
);

-- Seed widgets
INSERT INTO platform.dashboard_widgets (id, title, description, category, data_endpoint) VALUES
  ('sales_today', 'Prodeje dnes', 'Tržby za poslední den', 'sales', '/api/admin/widgets/sales-today'),
  ('live_feed', 'Live prodejní stream', 'Real-time SSE feed', 'sales', '/api/admin/sales-stream'),
  ('pricemaster', 'Pricemaster summary', 'Elasticita + sample size', 'pricing', '/api/admin/pricing-elasticity'),
  ('upcoming_events', 'Nadcházející akce', 'Top 5 nejbližších', 'events', '/api/admin/widgets/upcoming-events'),
  ('ad_performance', 'Ad campaigns', 'Win rate + CPC', 'marketing', '/api/admin/ad-auction-stats'),
  ('waitlist_count', 'Čekací listina', 'Velikost waitlistu napříč akcemi', 'sales', '/api/admin/widgets/waitlist-count'),
  ('refund_rate', 'Refund rate', '%refundovaných za 30 dní', 'finance', '/api/admin/widgets/refund-rate'),
  ('top_events', 'Nejprodávanější', 'Top 10 akcí podle tržeb', 'sales', '/api/admin/widgets/top-events')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 6. Enhanced Wallet Content Modules
-- ============================================================
CREATE TABLE IF NOT EXISTS tickets.wallet_content_modules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  module_type     text NOT NULL CHECK (module_type IN
                    ('apple_music_playlist', 'venue_map', 'parking_info', 'weather_link',
                     'merch_link', 'gate_instructions', 'food_menu', 'transportation',
                     'before_event_info', 'after_event_info', 'custom')),
  title           text NOT NULL,
  content         text,
  link_url        text,
  icon            text,
  -- Časování — TM Enhanced Wallet publikace 3 dny před, update 24h
  publish_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  is_active       boolean NOT NULL DEFAULT true,
  display_order   integer NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_modules_event
  ON tickets.wallet_content_modules(event_id, display_order)
  WHERE is_active = true;

COMMENT ON TABLE tickets.wallet_content_modules IS
  'TM Enhanced Wallet 2025 parita: Apple Music, mapa, parking, počasí, merch links on lock-screen pass.';

-- ============================================================
-- 7. Money-back guarantee labeling (resale)
-- ============================================================
ALTER TABLE resale.resale_listings
  ADD COLUMN IF NOT EXISTS has_money_back_guarantee boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS guarantee_label text DEFAULT 'Tixly Guarantee',
  ADD COLUMN IF NOT EXISTS source_label text;
  -- source_label: 'ticketmaster_resale', 'face_value', 'tixly_primary', 'external'

-- ============================================================
-- 8. Face Value Exchange visual labels — UI badge
-- ============================================================
-- mode column už existuje z migrace 290. Tato fáze přidává jen visual labels.
ALTER TABLE resale.resale_listings
  ADD COLUMN IF NOT EXISTS display_badge text;
  -- display_badge: 'face_value', 'verified', 'guarantee', 'discounted', ...

-- ============================================================
-- 9. GA Best Available sort
-- ============================================================
-- General Admission tickety budou auto-sorted by "best position"
-- (řada od pódia, nejnižší dostupný sektor). Markup: GA + ranking score.
ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS is_general_admission boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ga_position_score integer DEFAULT 0;
  -- ga_position_score: vyšší = lepší (closer to stage)

-- ============================================================
-- 10. Live ticket animations (config per event)
-- ============================================================
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS ticket_animation_type text DEFAULT 'pulse'
    CHECK (ticket_animation_type IN ('none', 'pulse', 'wave', 'sparkle', 'shimmer', 'rotate')),
  ADD COLUMN IF NOT EXISTS ticket_animation_color text,
  ADD COLUMN IF NOT EXISTS ticket_animation_speed text DEFAULT 'normal'
    CHECK (ticket_animation_speed IN ('slow', 'normal', 'fast'));

INSERT INTO public.schema_migrations (filename)
VALUES ('308_tm_parity_tm7_complete.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
