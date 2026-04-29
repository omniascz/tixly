CREATE TABLE IF NOT EXISTS admin_impersonation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  admin_id UUID NOT NULL,
  target_promoter_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_imp_token ON admin_impersonation_tokens(token) WHERE revoked_at IS NULL;
CREATE INDEX idx_imp_admin ON admin_impersonation_tokens(admin_id);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_admin_audit_admin ON admin_audit_log(admin_id);
CREATE INDEX idx_admin_audit_time ON admin_audit_log(created_at DESC);
CREATE INDEX idx_admin_audit_target ON admin_audit_log(target_type, target_id);
