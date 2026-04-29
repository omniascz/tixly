-- =============================================================================
-- Migration 164: Daily Stats Email
-- Feature #178: Automated morning digest of sales sent to promoters
-- =============================================================================

CREATE TABLE IF NOT EXISTS notifications.daily_stats_subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id         UUID NOT NULL UNIQUE,
  email               TEXT NOT NULL,
  send_hour_utc       INT NOT NULL DEFAULT 7 CHECK (send_hour_utc BETWEEN 0 AND 23),
  include_zero_sales  BOOLEAN NOT NULL DEFAULT true,  -- include events with 0 sales
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications.daily_stats_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id         UUID NOT NULL,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_date         DATE NOT NULL,
  events_count        INT NOT NULL DEFAULT 0,
  tickets_sold        INT NOT NULL DEFAULT 0,
  revenue_hellers     BIGINT NOT NULL DEFAULT 0,
  status              TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message       TEXT
);

CREATE SCHEMA IF NOT EXISTS notifications;

CREATE INDEX idx_daily_stats_log_promoter ON notifications.daily_stats_log(promoter_id, period_date DESC);
