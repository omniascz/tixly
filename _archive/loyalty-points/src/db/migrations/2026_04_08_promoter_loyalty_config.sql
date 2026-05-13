-- 2026-04-08 — per-promoter loyalty config (override globálních defaultů)

CREATE TABLE IF NOT EXISTS loyalty.promoter_config (
  promoter_id                           UUID PRIMARY KEY,
  tier_thresholds                       JSONB NOT NULL,
  tier_multipliers                      JSONB NOT NULL,
  base_earn_rate                        NUMERIC(6,3) NOT NULL DEFAULT 1.0,
  cashback_cap_pct                      NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  cashback_conversion_halire_per_point  INTEGER       NOT NULL DEFAULT 1,
  created_at                            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- RLS: promotéři vidí jen vlastní konfiguraci
ALTER TABLE loyalty.promoter_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY promoter_config_self ON loyalty.promoter_config
  USING (promoter_id = current_setting('app.promoter_id', true)::uuid);
