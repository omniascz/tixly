-- Migration 115: Social integrations — Facebook Events / TikTok (Feature #53)
-- Auto-publish akce na sociální sítě.

CREATE SCHEMA IF NOT EXISTS social;

CREATE TABLE social.event_shares (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL,              -- ref: catalog.events(id)
  promoter_id      UUID NOT NULL,              -- tenant
  platform         TEXT NOT NULL CHECK (platform IN ('facebook', 'tiktok')),
  external_event_id TEXT,                      -- FB event ID nebo TikTok video ID
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published', 'failed')),
  error_message    TEXT,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, platform)
);

CREATE INDEX idx_social_event   ON social.event_shares (event_id);
CREATE INDEX idx_social_promoter ON social.event_shares (promoter_id);
