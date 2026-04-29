-- =============================================================================
-- Migration 084: Action log + rollback
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  description TEXT,
  rollbackable BOOLEAN NOT NULL DEFAULT FALSE,
  rolled_back_at TIMESTAMPTZ,
  rolled_back_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_log_promoter_entity
  ON audit.action_log(promoter_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_action_log_promoter_created
  ON audit.action_log(promoter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_log_actor
  ON audit.action_log(actor_user_id);
