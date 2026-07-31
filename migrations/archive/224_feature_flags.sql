CREATE TABLE IF NOT EXISTS feature_flags_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created','updated','disabled','deleted')),
  previous_status TEXT,
  new_status TEXT,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ff_audit_key ON feature_flags_audit(flag_key);
CREATE INDEX idx_ff_audit_time ON feature_flags_audit(changed_at DESC);
