-- Migration 391: Payout execution tracking + multi-currency + EU provider support
--
-- Adds execution tracking to platform.payouts (which provider, external ID, status).
-- Adds Wise recipient caching, PayPal payout email, payout_currency to promoters.

-- Execution tracking on payout records
ALTER TABLE platform.payouts
  ADD COLUMN IF NOT EXISTS currency          TEXT NOT NULL DEFAULT 'CZK',
  ADD COLUMN IF NOT EXISTS payout_provider   TEXT,          -- 'wise' | 'paypal' | 'fio' | 'manual' | 'stripe_connect'
  ADD COLUMN IF NOT EXISTS external_payout_id TEXT,         -- Wise transferId, PayPal batch_id, FIO transaction ID
  ADD COLUMN IF NOT EXISTS failure_reason    TEXT,
  ADD COLUMN IF NOT EXISTS executed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_count       SMALLINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS payouts_status_idx      ON platform.payouts (status) WHERE status IN ('pending', 'processing', 'failed');
CREATE INDEX IF NOT EXISTS payouts_promoter_status ON platform.payouts (promoter_id, status);

-- Promoter payout routing extensions
ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS payout_currency    TEXT DEFAULT 'CZK',   -- preferred payout currency
  ADD COLUMN IF NOT EXISTS wise_recipient_id  BIGINT,               -- cached Wise recipient account ID
  ADD COLUMN IF NOT EXISTS paypal_payout_email TEXT;                -- PayPal account for receiving payouts

-- Index for EU/multi-currency payout lookups
CREATE INDEX IF NOT EXISTS promoters_payout_method_idx
  ON platform.promoters (payout_method)
  WHERE payout_method IS NOT NULL;
