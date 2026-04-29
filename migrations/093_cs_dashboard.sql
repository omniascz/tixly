-- =============================================================================
-- MIGRACE 093: CS Dashboard — cs.notes + cs.action_log
-- Datum: 2026-04-08
-- Modul: cs-dashboard
-- Závislosti: 001_initial.sql (auth.users)
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS cs;

-- ---------------------------------------------------------------------------
-- cs.notes — generické poznámky CS agentů k libovolné entitě
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cs.notes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT        NOT NULL,               -- 'order' | 'ticket' | 'user' | ...
  entity_id    TEXT        NOT NULL,               -- UUID jako text pro flexibilitu
  note         TEXT        NOT NULL CHECK (LENGTH(note) > 0),
  cs_user_id   UUID        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_notes_entity
  ON cs.notes (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_cs_notes_cs_user_id
  ON cs.notes (cs_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- cs.action_log — auditní trail všech CS akcí
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cs.action_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cs_user_id   UUID        NOT NULL,
  action_type  TEXT        NOT NULL,               -- 'refund' | 'reissue_ticket' | 'cancel_order' | 'blacklist' | 'unblacklist' | 'note'
  entity_type  TEXT        NOT NULL,               -- 'order' | 'ticket' | 'user'
  entity_id    TEXT        NOT NULL,
  description  TEXT        NOT NULL,
  metadata     JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_action_log_entity
  ON cs.action_log (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_cs_action_log_cs_user_id
  ON cs.action_log (cs_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cs_action_log_created_at
  ON cs.action_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cs_action_log_action_type
  ON cs.action_log (action_type);

COMMIT;
