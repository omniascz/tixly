-- =============================================================================
-- Migration 237: SMS marketing campaigns
--
-- Creates tables for campaign builder, segmentation, and performance tracking.
-- Runs after migration 236 (completed).
-- =============================================================================

-- Enable JSON support
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- campaigns table
-- Core campaign data: metadata, message, segment rules, scheduling/send times
-- =============================================================================

CREATE TABLE IF NOT EXISTS sms_marketing.campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  promoter_id UUID NOT NULL,
  name TEXT NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('informational', 'promotional')),
  body TEXT NOT NULL,

  -- Segment rules stored as JSON array
  -- Example: [{"type":"event_type","operator":"equals","values":["concert"]}]
  segment_rules JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Scheduling
  scheduled_at TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,

  -- Status: pending -> scheduled -> sent -> archived
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'sent', 'archived')),

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT campaigns_promoter_id_fk FOREIGN KEY (promoter_id) REFERENCES promoters(id) ON DELETE CASCADE
);

CREATE INDEX idx_campaigns_promoter_status ON sms_marketing.campaigns(promoter_id, status);
CREATE INDEX idx_campaigns_created_at ON sms_marketing.campaigns(created_at DESC);
CREATE INDEX idx_campaigns_scheduled_at ON sms_marketing.campaigns(scheduled_at) WHERE status = 'scheduled';

-- =============================================================================
-- campaign_statistics table
-- Performance metrics: delivery, engagement, opt-outs
-- =============================================================================

CREATE TABLE IF NOT EXISTS sms_marketing.campaign_statistics (
  campaign_id UUID PRIMARY KEY,
  sent_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  bounced_count INT NOT NULL DEFAULT 0,
  click_count INT NOT NULL DEFAULT 0,
  unsubscribe_count INT NOT NULL DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT campaign_stats_fk FOREIGN KEY (campaign_id) REFERENCES sms_marketing.campaigns(id) ON DELETE CASCADE
);

-- =============================================================================
-- Triggers for automatic timestamp updates
-- =============================================================================

CREATE OR REPLACE FUNCTION sms_marketing.update_campaign_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sms_marketing.update_stats_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaigns_update_timestamp
BEFORE UPDATE ON sms_marketing.campaigns
FOR EACH ROW
EXECUTE FUNCTION sms_marketing.update_campaign_timestamp();

CREATE TRIGGER campaign_stats_update_timestamp
BEFORE UPDATE ON sms_marketing.campaign_statistics
FOR EACH ROW
EXECUTE FUNCTION sms_marketing.update_stats_timestamp();

-- =============================================================================
-- Sample data for testing (optional — remove in production)
-- =============================================================================

-- INSERT INTO sms_marketing.campaigns
-- (promoter_id, name, type, body, segment_rules, status)
-- VALUES
-- (
--   'test-promoter-001',
--   'Summer Concert Promo',
--   'promotional',
--   'Save 20% on summer concert tickets! Use code SUMMER20',
--   '[{"type":"event_type","operator":"equals","values":["concert"]},{"type":"purchase_history","operator":"equals","values":["repeat"]}]'::jsonb,
--   'pending'
-- );
