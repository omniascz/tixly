-- 092_dynamic_pricing.sql — schéma pro modul AI Dynamic Pricing.
-- Pravidla cenotvorby a historie změn cen.
-- Všechny peněžní hodnoty v haléřích (INTEGER).

CREATE SCHEMA IF NOT EXISTS pricing;

-- ---------------------------------------------------------------------------
-- Pravidla cenotvorby per ticket type
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricing.rules (
  event_id UUID NOT NULL,
  ticket_type_id UUID NOT NULL,
  promoter_id UUID NOT NULL,
  strategy TEXT NOT NULL DEFAULT 'demand_curve'
    CHECK (strategy IN ('static', 'early_bird', 'demand_curve', 'time_decay', 'surge')),
  min_price_halire INTEGER NOT NULL DEFAULT 0
    CHECK (min_price_halire >= 0),
  max_price_halire INTEGER NOT NULL DEFAULT 99999900
    CHECK (max_price_halire >= 0),
  early_bird_discount_pct INTEGER NOT NULL DEFAULT 15
    CHECK (early_bird_discount_pct >= 0 AND early_bird_discount_pct <= 100),
  early_bird_threshold_pct INTEGER NOT NULL DEFAULT 20
    CHECK (early_bird_threshold_pct >= 0 AND early_bird_threshold_pct <= 100),
  surge_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.3
    CHECK (surge_multiplier >= 1.0 AND surge_multiplier <= 5.0),
  surge_velocity_threshold INTEGER NOT NULL DEFAULT 10
    CHECK (surge_velocity_threshold >= 0),
  time_decay_start_days INTEGER NOT NULL DEFAULT 30
    CHECK (time_decay_start_days >= 0),
  time_decay_max_increase_pct INTEGER NOT NULL DEFAULT 40
    CHECK (time_decay_max_increase_pct >= 0 AND time_decay_max_increase_pct <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, ticket_type_id)
);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_promoter
  ON pricing.rules(promoter_id);

-- ---------------------------------------------------------------------------
-- Historie změn cen (audit log)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricing.price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  ticket_type_id UUID NOT NULL,
  promoter_id UUID NOT NULL,
  old_price_halire INTEGER NOT NULL,
  new_price_halire INTEGER NOT NULL,
  strategy TEXT NOT NULL,
  reasons JSONB,
  confidence INTEGER NOT NULL DEFAULT 0
    CHECK (confidence >= 0 AND confidence <= 100),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_event
  ON pricing.price_history(event_id, ticket_type_id);

CREATE INDEX IF NOT EXISTS idx_price_history_applied
  ON pricing.price_history(applied_at);

-- RLS (pokud je zapnut)
ALTER TABLE pricing.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing.price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY pricing_rules_tenant ON pricing.rules
  USING (promoter_id = current_setting('app.current_promoter_id')::uuid);

CREATE POLICY pricing_history_tenant ON pricing.price_history
  USING (promoter_id = current_setting('app.current_promoter_id')::uuid);
