-- =============================================================================
-- Migration 136: Real-Time Revenue Calculations
-- Feature #40: Show revenue impact on admin UI when capacity/price changes
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS revenue;

-- Revenue projections per event
CREATE TABLE revenue.projections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES catalog.events(id),
  promoter_id       UUID NOT NULL,
  total_capacity    INT NOT NULL,
  current_sold      INT NOT NULL,
  base_price_hellers INT NOT NULL,  -- Average price in halíře
  projected_revenue_hellers INT NOT NULL,  -- Current projection
  worst_case_revenue_hellers INT,  -- 40% capacity
  mid_case_revenue_hellers INT,    -- 70% capacity
  best_case_revenue_hellers INT,   -- 100% capacity
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id)
);

-- Revenue impact history (audit trail for what-if scenarios)
CREATE TABLE revenue.impact_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES catalog.events(id),
  scenario_type     TEXT NOT NULL CHECK (scenario_type IN ('capacity_change', 'price_change', 'mixed')),
  base_revenue_hellers INT NOT NULL,
  new_revenue_hellers INT NOT NULL,
  impact_hellers    INT,
  impact_percent    DECIMAL(5,2),
  parameters        JSONB,  -- Stores the what-if parameters
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dynamic pricing tiers for what-if scenarios
CREATE TABLE revenue.pricing_scenarios (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES catalog.events(id),
  promoter_id       UUID NOT NULL,
  scenario_name     TEXT NOT NULL,
  base_price_hellers INT NOT NULL,
  adjusted_price_hellers INT NOT NULL,
  expected_sold_percent DECIMAL(5,2) NOT NULL DEFAULT 100.0,
  projected_revenue_hellers INT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_projections_event ON revenue.projections(event_id);
CREATE INDEX idx_projections_promoter ON revenue.projections(promoter_id, event_id);
CREATE INDEX idx_impact_history_event ON revenue.impact_history(event_id);
CREATE INDEX idx_impact_history_calculated_at ON revenue.impact_history(calculated_at);
CREATE INDEX idx_pricing_scenarios_event ON revenue.pricing_scenarios(event_id);
