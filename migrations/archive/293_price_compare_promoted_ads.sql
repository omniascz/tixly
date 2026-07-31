-- 293_price_compare_promoted_ads.sql
-- TM Parity Fáze 3:
-- 1. Price compare scenarios — promotér porovnává "co kdyby" cenové strategie
-- 2. Promoted Ads cross-promo — bidding na jiných promotérů event slots
-- 3. Real-time sales events publish stream (pro SSE dashboard)

BEGIN;

CREATE SCHEMA IF NOT EXISTS revenue;

-- ============================================================
-- 1. Price Compare Scenarios
-- ============================================================
CREATE TABLE IF NOT EXISTS revenue.price_scenarios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  event_id        uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  name            text NOT NULL,           -- "Aggressive +15%", "Early bird 20% off"
  description     text,
  -- Definice scénáře jako JSON: { ticket_type_id: {price_change_pct, capacity_shift_pct} }
  price_adjustments jsonb NOT NULL DEFAULT '{}',
  -- Projected outcomes (computed)
  projected_revenue_halire bigint,
  projected_sold_tickets   integer,
  projected_conversion_pct numeric(5,2),
  -- Comparison baseline (snapshot z current pricing)
  baseline_revenue_halire  bigint,
  baseline_sold_tickets    integer,
  -- Lifecycle
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'modeled', 'applied', 'rejected')),
  applied_at      timestamptz,
  created_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_scenarios_event
  ON revenue.price_scenarios(event_id, status);

COMMENT ON TABLE revenue.price_scenarios IS
  'TM Pricemaster-style price scenarios. Promotér modeluje "co kdyby" před aplikací.';

-- ============================================================
-- 2. Promoted Ads — Cross-Promo Bidding
-- ============================================================
-- Rozšíření existujících marketing.ad_campaigns o cross-promo capability
ALTER TABLE marketing.ad_campaigns
  ADD COLUMN IF NOT EXISTS cross_promo_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS target_event_categories text[],
  ADD COLUMN IF NOT EXISTS target_promoter_ids uuid[],
  ADD COLUMN IF NOT EXISTS bid_strategy text NOT NULL DEFAULT 'cpc'
    CHECK (bid_strategy IN ('cpc', 'cpm', 'auto'));

COMMENT ON COLUMN marketing.ad_campaigns.cross_promo_enabled IS
  'Pokud true, campaign může vyhrávat slots na jiných promotérů event pages (cross-promo). Bidding více competitive.';

-- Ad placements log (pro analytics — kde ad zobrazila)
CREATE TABLE IF NOT EXISTS marketing.ad_placements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES marketing.ad_campaigns(id) ON DELETE CASCADE,
  shown_on_event_id uuid REFERENCES catalog.events(id) ON DELETE SET NULL,
  shown_on_promoter_id uuid REFERENCES platform.promoters(id) ON DELETE SET NULL,
  slot            text NOT NULL,
  is_cross_promo  boolean NOT NULL DEFAULT false,
  shown_at        timestamptz NOT NULL DEFAULT now(),
  clicked         boolean NOT NULL DEFAULT false,
  clicked_at      timestamptz,
  cpc_charged_halire integer,
  user_id         uuid,
  ip_hash         text
);

CREATE INDEX IF NOT EXISTS idx_ad_placements_campaign
  ON marketing.ad_placements(campaign_id, shown_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_placements_clicks
  ON marketing.ad_placements(campaign_id) WHERE clicked = true;

-- ============================================================
-- 3. Sales Events Stream (pro real-time SSE dashboard)
-- ============================================================
-- Lightweight append-only log — kdykoliv order paid → insert.
-- SSE endpoint pollne new rows since last cursor.
CREATE TABLE IF NOT EXISTS revenue.sales_stream (
  id              bigserial PRIMARY KEY,
  promoter_id     uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  event_id        uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  order_id        uuid NOT NULL,
  amount_halire   integer NOT NULL,
  currency        text NOT NULL DEFAULT 'CZK',
  ticket_count    integer NOT NULL DEFAULT 1,
  event_title     text NOT NULL,
  buyer_country   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_stream_promoter_time
  ON revenue.sales_stream(promoter_id, created_at DESC);

COMMENT ON TABLE revenue.sales_stream IS
  'Real-time append-only sales log. SSE endpoint polluje WHERE created_at > last_cursor.';

COMMIT;
