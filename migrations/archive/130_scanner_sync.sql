-- =============================================================================
-- Migration 130: Scanner PWA Sync Infrastructure
-- Tables for offline-first mobile scanner synchronization
-- =============================================================================

-- Scan log for recording scans (idempotent on ticket_id + scanned_at)
CREATE TABLE IF NOT EXISTS tickets.scans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id         UUID NOT NULL REFERENCES tickets.tickets(id),
  scanned_at        TIMESTAMPTZ NOT NULL,
  result            TEXT NOT NULL CHECK (result IN ('valid', 'invalid', 'already_scanned')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ticket_id, scanned_at)
);

-- Metadata for delta sync tracking per device/event
CREATE TABLE IF NOT EXISTS scanner.sync_metadata (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id         TEXT NOT NULL,
  event_id          UUID NOT NULL REFERENCES catalog.events(id),
  last_sync_at      BIGINT NOT NULL DEFAULT 0,
  cached_ticket_count INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(device_id, event_id)
);

-- Scanned tokens for anti-replay detection (in-memory in mobile app, but logged server-side)
CREATE TABLE IF NOT EXISTS scanner.scanned_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id         TEXT NOT NULL,
  ticket_id         UUID NOT NULL,
  totp_code         TEXT NOT NULL,
  scanned_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(device_id, ticket_id, totp_code)
);

-- Indexes for efficient queries
CREATE INDEX idx_scans_ticket_scanned_at ON tickets.scans(ticket_id, scanned_at);
CREATE INDEX idx_scans_created_at ON tickets.scans(created_at);
CREATE INDEX idx_sync_metadata_device_event ON scanner.sync_metadata(device_id, event_id);
CREATE INDEX idx_scanned_tokens_device_ticket ON scanner.scanned_tokens(device_id, ticket_id);

-- Create schema if not exists
CREATE SCHEMA IF NOT EXISTS scanner;
