-- 279_newsletter_last_digest.sql
-- Idempotency column pro newsletter-digest cron — 1× týdně per subscriber max.

BEGIN;

ALTER TABLE marketing.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS last_digest_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_newsletter_last_digest
  ON marketing.newsletter_subscribers(last_digest_sent_at NULLS FIRST)
  WHERE status = 'confirmed';

COMMIT;
