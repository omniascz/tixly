-- =============================================================================
-- Migration 149: Discovery Feed / Catalog API
-- Feature #44: JSON/CSV feed of public events for distribution partners,
--              aggregators (GoOut) and SEO. Ticketmaster Discovery API equivalent.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS discovery_feed;

-- API subscriptions: distribution partners get an API key
CREATE TABLE IF NOT EXISTS discovery_feed.feed_subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_name        TEXT NOT NULL,
  contact_email       TEXT NOT NULL,
  api_key             TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  allowed_promoters   UUID[],                 -- NULL = all public events; restricted = specific promoters only
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  rate_limit_per_hour INT NOT NULL DEFAULT 1000,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at        TIMESTAMPTZ
);

-- Access log for usage metering and abuse detection
CREATE TABLE IF NOT EXISTS discovery_feed.feed_access_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id     UUID NOT NULL REFERENCES discovery_feed.feed_subscriptions(id),
  endpoint            TEXT NOT NULL,          -- '/feed/events' or '/feed/events/{id}'
  format              TEXT NOT NULL DEFAULT 'json' CHECK (format IN ('json', 'csv')),
  filters             JSONB,                  -- query params as JSON snapshot
  result_count        INT,
  response_ms         INT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feed_access_log_subscription ON discovery_feed.feed_access_log(subscription_id);
CREATE INDEX idx_feed_access_log_created ON discovery_feed.feed_access_log(created_at);
