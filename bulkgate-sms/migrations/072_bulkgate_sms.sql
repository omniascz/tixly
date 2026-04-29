-- =============================================================================
-- 072_bulkgate_sms: generický SMS systém (transakční + marketingové SMS)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS sms;

CREATE TABLE sms.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID,
  recipient_phone TEXT NOT NULL,
  text TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  external_id TEXT,
  error_message TEXT,
  cost_halire INTEGER,
  segment_name TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sms_promoter ON sms.messages(promoter_id, created_at DESC);
CREATE INDEX idx_sms_phone ON sms.messages(recipient_phone);
CREATE INDEX idx_sms_status ON sms.messages(status);

CREATE TABLE sms.opt_outs (
  phone TEXT PRIMARY KEY,
  opted_out_at TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT
);
