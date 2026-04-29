CREATE SCHEMA IF NOT EXISTS config;

CREATE TABLE config.entries (
  promoter_id UUID NOT NULL,
  key TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  value_type TEXT NOT NULL,
  label TEXT,
  description TEXT,
  category TEXT,
  validation JSONB,
  updated_by UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (promoter_id, key)
);
CREATE INDEX idx_config_category ON config.entries(promoter_id, category);
