-- 437_demand_forecast
-- Demand Forecasting / Yield Management.
-- Ukládá predikce poptávky (denní/týdenní) per event + přepisovatelné price thresholds.
-- Cron každých 6h přepočítá score (velocity + historical comp) a zapíše snapshot.

CREATE TABLE IF NOT EXISTS analytics.demand_forecasts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid        NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  days_to_event   int         NOT NULL,
  tickets_sold    int         NOT NULL,
  tickets_total   int         NOT NULL,
  pct_sold        numeric(5,2) NOT NULL,
  velocity_7d     numeric(10,2),
  velocity_1d     numeric(10,2),
  forecast_sold   int,
  forecast_pct    numeric(5,2),
  demand_score    numeric(5,2),
  recommendation  text        CHECK (recommendation IN ('raise_price', 'lower_price', 'hold', 'flash_sale', 'last_minute')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demand_forecasts_event
  ON analytics.demand_forecasts (event_id, computed_at DESC);

CREATE TABLE IF NOT EXISTS analytics.yield_rules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid        NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  promoter_id     uuid        NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  pct_threshold   numeric(5,2) NOT NULL,
  action          text        NOT NULL CHECK (action IN ('raise_price', 'lower_price', 'flash_sale', 'notify')),
  price_delta_pct numeric(5,2),
  notification_email text,
  is_active       boolean     NOT NULL DEFAULT true,
  triggered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yield_rules_event
  ON analytics.yield_rules (event_id);

ALTER TABLE analytics.demand_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.yield_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY df_select_promoter ON analytics.demand_forecasts
  FOR SELECT USING (
    event_id IN (
      SELECT id FROM catalog.events
      WHERE promoter_id::text = current_setting('app.current_promoter_id', true)
    )
    OR current_setting('app.role', true) = 'system'
    OR current_setting('app.is_platform_admin', true) = 'true'
  );

CREATE POLICY df_insert_service ON analytics.demand_forecasts
  FOR INSERT WITH CHECK (
    current_setting('app.role', true) = 'system'
  );

CREATE POLICY yr_select_promoter ON analytics.yield_rules
  FOR SELECT USING (
    promoter_id::text = current_setting('app.current_promoter_id', true)
    OR current_setting('app.role', true) = 'system'
  );

CREATE POLICY yr_insert_promoter ON analytics.yield_rules
  FOR INSERT WITH CHECK (
    promoter_id::text = current_setting('app.current_promoter_id', true)
  );

CREATE POLICY yr_update_promoter ON analytics.yield_rules
  FOR UPDATE USING (
    promoter_id::text = current_setting('app.current_promoter_id', true)
    OR current_setting('app.role', true) = 'system'
  );

CREATE POLICY yr_delete_promoter ON analytics.yield_rules
  FOR DELETE USING (
    promoter_id::text = current_setting('app.current_promoter_id', true)
  );
