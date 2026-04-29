CREATE TABLE IF NOT EXISTS onboarding_wizard_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL,
  current_step TEXT NOT NULL DEFAULT 'event_basics',
  completed_steps TEXT[] NOT NULL DEFAULT '{}',
  data JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','completed','abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);
CREATE INDEX idx_wizard_promoter ON onboarding_wizard_sessions(promoter_id) WHERE status = 'in_progress';
CREATE INDEX idx_wizard_expires ON onboarding_wizard_sessions(expires_at) WHERE status = 'in_progress';
