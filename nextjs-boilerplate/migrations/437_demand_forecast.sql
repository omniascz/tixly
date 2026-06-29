-- Migration 437: Demand forecasting / yield management
-- Stores rule-based demand forecasts per event (computed by cron + on-demand API).

CREATE TABLE IF NOT EXISTS analytics.demand_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  ticket_type_id uuid REFERENCES catalog.ticket_types(id) ON DELETE CASCADE,
  computed_at timestamptz NOT NULL DEFAULT now(),
  days_to_event int NOT NULL,
  sold_pct numeric(5,2) NOT NULL,
  velocity_per_day numeric(10,2) NOT NULL,
  projected_final_pct numeric(5,2),
  recommended_price_halire bigint,
  price_change_reason text,
  auto_applied boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS demand_forecasts_event_idx ON analytics.demand_forecasts (event_id, computed_at DESC);

ALTER TABLE analytics.demand_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY demand_forecasts_promoter ON analytics.demand_forecasts
  FOR SELECT
  USING (
    event_id IN (
      SELECT id FROM catalog.events
      WHERE promoter_id::text = current_setting('app.current_promoter_id', true)
    )
  );

CREATE POLICY demand_forecasts_admin ON analytics.demand_forecasts
  FOR ALL
  USING (current_setting('app.is_platform_admin', true) = 'true');
