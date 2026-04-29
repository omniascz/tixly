-- =============================================================================
-- 062_identity_clients_source.sql
-- Acquisition source tracking for clients (web, sms, direct, referral, import).
-- PulseUp had klienti.source — needed for marketing attribution + segmentation.
-- =============================================================================

ALTER TABLE identity.clients
  ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'web';

COMMENT ON COLUMN identity.clients.source IS
  'Client acquisition channel: web, sms, direct, referral, import, api, admin_manual';

CREATE INDEX IF NOT EXISTS idx_identity_clients_source
  ON identity.clients(source);
