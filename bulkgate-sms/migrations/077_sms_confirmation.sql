-- =============================================================================
-- 077_sms_confirmation: SMS confirmation codes table and opt-out enhancements
-- =============================================================================

-- SMS confirmation table for 6-digit verification codes
CREATE TABLE IF NOT EXISTS sms.confirmation_sms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_phone TEXT NOT NULL,
  confirmation_code TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_id UUID,
  promoter_id UUID,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'delivered')),
  external_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for confirmation SMS queries
CREATE INDEX idx_confirmation_sms_phone ON sms.confirmation_sms(recipient_phone);
CREATE INDEX idx_confirmation_sms_status ON sms.confirmation_sms(status);
CREATE INDEX idx_confirmation_sms_event ON sms.confirmation_sms(event_id);
CREATE INDEX idx_confirmation_sms_created ON sms.confirmation_sms(created_at DESC);
CREATE INDEX idx_confirmation_sms_code ON sms.confirmation_sms(confirmation_code);

-- Enhance opt_outs table with user tracking
ALTER TABLE sms.opt_outs ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE sms.opt_outs ADD COLUMN IF NOT EXISTS reason TEXT;

-- Index for user opt-outs
CREATE INDEX IF NOT EXISTS idx_opt_outs_user ON sms.opt_outs(user_id);
CREATE INDEX IF NOT EXISTS idx_opt_outs_date ON sms.opt_outs(opted_out_at DESC);
