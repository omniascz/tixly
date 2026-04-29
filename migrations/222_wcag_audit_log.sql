CREATE TABLE IF NOT EXISTS wcag_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID,
  page_path TEXT NOT NULL,
  violation_type TEXT NOT NULL,
  violation_description TEXT,
  user_agent TEXT,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wcag_audit_promoter ON wcag_audit_log(promoter_id);
CREATE INDEX idx_wcag_audit_type ON wcag_audit_log(violation_type);
