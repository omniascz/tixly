-- =============================================================================
-- Migration 152: Multi-Zone Capacity Tracking
-- Feature #192: Track real-time occupancy per zone for capacity management
--              Extends zone-access module with entry/exit tracking
-- =============================================================================

-- Zone occupancy tracking: real-time count of who's inside a zone
CREATE TABLE IF NOT EXISTS zone_access.zone_occupancy (
  zone_id             TEXT NOT NULL,          -- references zone_access.zones.id
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  current_count       INT NOT NULL DEFAULT 0 CHECK (current_count >= 0),
  max_capacity        INT,                    -- NULL = unlimited
  last_updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (zone_id, event_id)
);

-- Re-entry log: track each entry and exit per ticket per zone
CREATE TABLE IF NOT EXISTS zone_access.zone_passage_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id           UUID NOT NULL,
  zone_id             TEXT NOT NULL,
  event_id            UUID NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('entry', 'exit')),
  gate_id             TEXT NOT NULL,
  staff_id            UUID,
  scanned_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-ticket zone assignments (overrides ticket-type defaults for special tickets)
CREATE TABLE IF NOT EXISTS zone_access.ticket_zone_overrides (
  ticket_id           UUID NOT NULL,
  zone_id             TEXT NOT NULL,
  event_id            UUID NOT NULL,
  granted_by          UUID NOT NULL,
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  PRIMARY KEY (ticket_id, zone_id)
);

CREATE INDEX idx_zone_passage_ticket ON zone_access.zone_passage_log(ticket_id);
CREATE INDEX idx_zone_passage_zone ON zone_access.zone_passage_log(zone_id, event_id);
CREATE INDEX idx_zone_passage_scanned ON zone_access.zone_passage_log(scanned_at);
CREATE INDEX idx_ticket_zone_overrides_ticket ON zone_access.ticket_zone_overrides(ticket_id);
