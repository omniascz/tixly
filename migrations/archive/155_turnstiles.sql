-- =============================================================================
-- Migration 155: Turnikety integrace
-- Feature #187: Physical turnstile/gate integration for large venues
--              API for open/close gate based on ticket validation in real time
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS turnstiles;

-- Turnstile device: a physical gate at a venue
CREATE TABLE IF NOT EXISTS turnstiles.turnstile_devices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  venue_id            TEXT NOT NULL,
  device_id           TEXT NOT NULL UNIQUE,   -- hardware identifier (e.g. MAC address)
  name                TEXT NOT NULL,          -- 'Brána A – severní', 'VIP vstup'
  zone_id             TEXT,                   -- zone this turnstile controls
  gate_type           TEXT NOT NULL DEFAULT 'entry' CHECK (gate_type IN ('entry', 'exit', 'bidirectional')),
  status              TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'error', 'maintenance')),
  last_heartbeat_at   TIMESTAMPTZ,
  firmware_version    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Turnstile events: each gate action (open/close, passage)
CREATE TABLE IF NOT EXISTS turnstiles.turnstile_passages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id           TEXT NOT NULL,
  ticket_id           UUID,                   -- NULL if ticket not resolved (denied)
  qr_payload          TEXT,                   -- raw QR scanned
  direction           TEXT NOT NULL CHECK (direction IN ('entry', 'exit')),
  result              TEXT NOT NULL CHECK (result IN ('granted', 'denied', 'error')),
  deny_reason         TEXT,
  gate_open_ms        INT,                    -- how long gate was open (ms)
  latency_ms          INT,                    -- validation latency (ms)
  processed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Capacity counters: real-time per-turnstile and per-zone counters
CREATE TABLE IF NOT EXISTS turnstiles.capacity_counters (
  device_id           TEXT NOT NULL,
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  entries_count       INT NOT NULL DEFAULT 0,
  exits_count         INT NOT NULL DEFAULT 0,
  current_inside      INT NOT NULL DEFAULT 0 CHECK (current_inside >= 0),
  last_passage_at     TIMESTAMPTZ,
  PRIMARY KEY (device_id, event_id)
);

CREATE INDEX idx_turnstile_passages_device ON turnstiles.turnstile_passages(device_id);
CREATE INDEX idx_turnstile_passages_ticket ON turnstiles.turnstile_passages(ticket_id);
CREATE INDEX idx_turnstile_passages_processed ON turnstiles.turnstile_passages(processed_at);
CREATE INDEX idx_turnstile_devices_event ON turnstiles.turnstile_devices(event_id);
