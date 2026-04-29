-- =============================================================================
-- 082_bulk_email.sql
-- Bulk email campaigns with segmentation and per-recipient tracking.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS bulk_email;

CREATE TABLE bulk_email.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  segment JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_campaigns_promoter_status ON bulk_email.campaigns(promoter_id, status);

CREATE TABLE bulk_email.recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES bulk_email.campaigns(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  error_message TEXT
);
CREATE INDEX idx_recipients_campaign_status ON bulk_email.recipients(campaign_id, status);
