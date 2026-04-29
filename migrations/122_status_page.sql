-- Migration 122: Status page (Feature #169)

CREATE SCHEMA IF NOT EXISTS monitoring;

CREATE TABLE monitoring.system_components (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'operational'
                     CHECK (status IN ('operational', 'degraded', 'down')),
  last_updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO monitoring.system_components (id, name, description) VALUES
  ('api', 'Main API', 'Ticketing API'),
  ('payment_gateway', 'Payment Gateway', 'GoPay, Stripe, Przelewy24'),
  ('scanner', 'Scanner PWA', 'QR code validation'),
  ('webhooks', 'Webhooks', 'Payment & event notifications'),
  ('database', 'Database', 'PostgreSQL primary');

CREATE TABLE monitoring.status_incidents (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   TEXT NOT NULL,
  description             TEXT,
  affected_component_ids  TEXT[] NOT NULL,
  severity                TEXT NOT NULL CHECK (severity IN ('informational', 'minor', 'major', 'critical')),
  status                  TEXT NOT NULL DEFAULT 'investigating'
                            CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at             TIMESTAMPTZ,
  updates                 JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [ { message, timestamp } ]
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_incidents_active ON monitoring.status_incidents (status)
  WHERE status != 'resolved';
CREATE INDEX idx_incidents_resolved_recent ON monitoring.status_incidents (resolved_at DESC)
  WHERE resolved_at > NOW() - INTERVAL '7 days';
