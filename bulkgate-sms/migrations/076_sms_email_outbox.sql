-- =============================================================================
-- 076_sms_email_outbox.sql
-- Outbox tables for asynchronous SMS & email dispatch.
-- A cron job polls these tables and sends via BulkGate / Mailgun / Twilio.
-- Deduplication: UNIQUE on (phone, text, created_at::date) / (email, subject, created_at::date)
-- to prevent accidental double-sends from quick campaign retries.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS sms;
CREATE SCHEMA IF NOT EXISTS email;

CREATE TABLE IF NOT EXISTS sms.outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'transactional',
  promoter_id UUID,
  created_by UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (phone, text, (created_at::date))
);

CREATE INDEX idx_sms_outbox_pending ON sms.outbox(status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS email.outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  category TEXT NOT NULL DEFAULT 'transactional',
  promoter_id UUID,
  created_by UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (email, subject, (created_at::date))
);

CREATE INDEX idx_email_outbox_pending ON email.outbox(status) WHERE status = 'pending';
