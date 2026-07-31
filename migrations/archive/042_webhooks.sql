-- Migration 042: Outbound Webhooks
-- Schema: reservations

-- ---------------------------------------------------------------------------
-- Table: reservations.webhook_endpoints
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.webhook_endpoints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID NOT NULL,
  url             TEXT NOT NULL,
  description     VARCHAR(200),
  secret          VARCHAR(100) NOT NULL,
  events          TEXT[] NOT NULL,
  is_active       BOOL DEFAULT true,
  timeout_ms      INT DEFAULT 5000,
  max_retries     INT DEFAULT 3,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_triggered_at TIMESTAMPTZ,
  UNIQUE (promoter_id, url)
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_promoter_active
  ON reservations.webhook_endpoints (promoter_id, is_active);

-- ---------------------------------------------------------------------------
-- Table: reservations.webhook_deliveries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.webhook_deliveries (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id          UUID NOT NULL REFERENCES reservations.webhook_endpoints(id) ON DELETE CASCADE,
  event_type           VARCHAR(100) NOT NULL,
  event_id             UUID NOT NULL,
  payload              JSONB NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'success', 'failed', 'retrying')),
  attempt_count        INT DEFAULT 0,
  next_retry_at        TIMESTAMPTZ,
  last_response_status INT,
  last_response_body   TEXT,
  last_error           TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  delivered_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint_status
  ON reservations.webhook_deliveries (endpoint_id, status);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry
  ON reservations.webhook_deliveries (next_retry_at)
  WHERE status = 'retrying';

-- ---------------------------------------------------------------------------
-- Table: reservations.webhook_event_log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations.webhook_event_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id        UUID NOT NULL,
  event_type         VARCHAR(100) NOT NULL,
  event_id           UUID DEFAULT gen_random_uuid(),
  source_entity_type VARCHAR(50),
  source_entity_id   UUID,
  payload            JSONB NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_event_log_promoter_type
  ON reservations.webhook_event_log (promoter_id, event_type);

CREATE INDEX IF NOT EXISTS idx_webhook_event_log_created_at
  ON reservations.webhook_event_log (created_at);
