-- 296_pricing_engine_ad_auction.sql
-- TM Parity Fáze 6 — Pricing engine + Promoted Ads ML:
-- 1. Price history (kompletní log změn cen)
-- 2. Time-based pricing windows (early bird, late surge)
-- 3. A/B price tests
-- 4. Promoted Ads auction log + CTR-based bid scoring
-- 5. Elasticity learning (computed view)

BEGIN;

-- ============================================================
-- 1. Price History — každá změna ceny = row
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog.ticket_type_price_history (
  id              bigserial PRIMARY KEY,
  ticket_type_id  uuid NOT NULL REFERENCES catalog.ticket_types(id) ON DELETE CASCADE,
  old_price       integer NOT NULL,
  new_price       integer NOT NULL,
  change_source   text NOT NULL CHECK (change_source IN
                    ('manual', 'dynamic_velocity', 'dynamic_scarcity', 'pricing_window',
                     'ab_test_variant', 'pricing_rule_engine', 'scenario_applied')),
  change_reason   text,
  changed_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  signals         jsonb,
  changed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_ticket_type
  ON catalog.ticket_type_price_history(ticket_type_id, changed_at DESC);

COMMENT ON TABLE catalog.ticket_type_price_history IS
  'Append-only log price changes. Source pro elasticity learning + audit.';

-- ============================================================
-- 2. Time-based Pricing Windows (early bird, late surge)
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog.pricing_windows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id  uuid NOT NULL REFERENCES catalog.ticket_types(id) ON DELETE CASCADE,
  name            text NOT NULL,             -- "Early bird -20%", "Last week surge +15%"
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  price_override  integer,                   -- absolutní cena v haléřích
  price_change_pct numeric(5,2),             -- ALTERNATIVA: relativní % change
  priority        integer NOT NULL DEFAULT 100, -- vyšší = preference
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (price_override IS NOT NULL OR price_change_pct IS NOT NULL),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_pricing_windows_active
  ON catalog.pricing_windows(ticket_type_id, starts_at, ends_at) WHERE enabled = true;

COMMENT ON TABLE catalog.pricing_windows IS
  'Time-based pricing rules. Eg. "do 30. května = -20%, posledních 7 dní = +15%".';

-- ============================================================
-- 3. A/B Price Tests
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog.ab_price_tests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id  uuid NOT NULL REFERENCES catalog.ticket_types(id) ON DELETE CASCADE,
  name            text NOT NULL,
  variant_a_price integer NOT NULL,
  variant_b_price integer NOT NULL,
  -- 50 = 50/50 split, 30 = 30% B + 70% A
  variant_b_pct   integer NOT NULL DEFAULT 50 CHECK (variant_b_pct BETWEEN 1 AND 99),
  starts_at       timestamptz NOT NULL DEFAULT now(),
  ends_at         timestamptz,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'finished', 'rolled_back')),
  -- Counters (computed via trigger / job)
  variant_a_visitors integer NOT NULL DEFAULT 0,
  variant_b_visitors integer NOT NULL DEFAULT 0,
  variant_a_conversions integer NOT NULL DEFAULT 0,
  variant_b_conversions integer NOT NULL DEFAULT 0,
  winner_variant  text CHECK (winner_variant IN ('a', 'b', NULL)),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ab_price_tests_active
  ON catalog.ab_price_tests(ticket_type_id, status);

-- Per-session assignment log
CREATE TABLE IF NOT EXISTS catalog.ab_price_assignments (
  id              bigserial PRIMARY KEY,
  test_id         uuid NOT NULL REFERENCES catalog.ab_price_tests(id) ON DELETE CASCADE,
  session_hash    text NOT NULL,
  variant         text NOT NULL CHECK (variant IN ('a', 'b')),
  shown_price     integer NOT NULL,
  converted       boolean NOT NULL DEFAULT false,
  conversion_order_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (test_id, session_hash)
);

-- ============================================================
-- 4. Promoted Ads Auction Log
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing.ad_auction_log (
  id              bigserial PRIMARY KEY,
  -- Kontext aukce
  slot            text NOT NULL,
  shown_on_event_id uuid REFERENCES catalog.events(id) ON DELETE SET NULL,
  shown_on_promoter_id uuid REFERENCES platform.promoters(id) ON DELETE SET NULL,
  -- Účastníci aukce + jejich score
  participants    jsonb NOT NULL,            -- [{campaign_id, bid_halire, ctr, score}]
  -- Vítěz
  winning_campaign_id uuid REFERENCES marketing.ad_campaigns(id) ON DELETE SET NULL,
  winning_score   numeric(10,4),
  -- Second-price billing (vítěz platí 2nd-highest bid + 1)
  charged_halire  integer,
  -- Audit
  user_session_hash text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_auction_log_winner
  ON marketing.ad_auction_log(winning_campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_auction_log_event
  ON marketing.ad_auction_log(shown_on_event_id, created_at DESC);

COMMENT ON TABLE marketing.ad_auction_log IS
  'TM-style second-price auction log. Score = bid × CTR_quality_factor.';

-- ============================================================
-- 5. Elasticity Learning View
-- ============================================================
-- Vypočítá pozorovanou price elasticity z historie:
-- elasticity = % change in demand / % change in price
CREATE OR REPLACE VIEW catalog.vw_price_elasticity AS
WITH price_changes AS (
  SELECT
    h.ticket_type_id,
    h.old_price, h.new_price,
    h.changed_at,
    LEAD(h.changed_at) OVER (PARTITION BY h.ticket_type_id ORDER BY h.changed_at) AS next_change_at,
    (h.new_price - h.old_price)::numeric / NULLIF(h.old_price, 0) AS price_pct_change
  FROM catalog.ticket_type_price_history h
  WHERE h.old_price > 0
),
demand_windows AS (
  SELECT
    pc.ticket_type_id,
    pc.price_pct_change,
    (SELECT COUNT(*) FROM orders.order_items oi
       JOIN orders.orders o ON o.id = oi.order_id
      WHERE oi.ticket_type_id = pc.ticket_type_id
        AND o.created_at >= pc.changed_at - INTERVAL '24 hours'
        AND o.created_at < pc.changed_at
        AND o.status IN ('paid', 'paid_partial')) AS demand_before,
    (SELECT COUNT(*) FROM orders.order_items oi
       JOIN orders.orders o ON o.id = oi.order_id
      WHERE oi.ticket_type_id = pc.ticket_type_id
        AND o.created_at >= pc.changed_at
        AND o.created_at < COALESCE(pc.next_change_at, pc.changed_at + INTERVAL '24 hours')
        AND o.status IN ('paid', 'paid_partial')) AS demand_after,
    pc.changed_at
  FROM price_changes pc
)
SELECT
  ticket_type_id,
  price_pct_change,
  demand_before,
  demand_after,
  CASE
    WHEN demand_before > 0 AND price_pct_change != 0
    THEN ((demand_after - demand_before)::numeric / demand_before) / price_pct_change
    ELSE NULL
  END AS observed_elasticity,
  changed_at
FROM demand_windows
WHERE demand_before > 0 OR demand_after > 0;

COMMENT ON VIEW catalog.vw_price_elasticity IS
  'Observed price elasticity per ticket_type. Drives learning loop pro auto-tuning rules.';

INSERT INTO public.schema_migrations (filename)
VALUES ('296_pricing_engine_ad_auction.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
