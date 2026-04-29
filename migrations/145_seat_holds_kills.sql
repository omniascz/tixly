-- =============================================================================
-- Migration 145: Holds & Kills in Seat Map
-- Feature #39: Reserve seats for production/artist/sponsor (Hold) or permanent removal (Kill)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS seat_holds;

-- Hold/kill types
-- hold: temporarily reserved for a named purpose (can be released)
-- kill: permanently removed from sale (structural issue, sponsor blackout, etc.)
CREATE TABLE IF NOT EXISTS seat_holds.seat_holds (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  seat_id             TEXT NOT NULL,          -- matches Seat.id from seat-map
  hold_type           TEXT NOT NULL CHECK (hold_type IN ('hold', 'kill')),
  category            TEXT NOT NULL CHECK (category IN ('production', 'artist', 'sponsor', 'press', 'accessibility', 'venue', 'other')),
  label               TEXT,                   -- e.g. "Harry Styles guest list", "Camera platform"
  held_by             UUID NOT NULL,          -- promoter or staff user UUID
  notes               TEXT,
  released_at         TIMESTAMPTZ,            -- NULL = still held/killed
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, seat_id, hold_type, released_at)  -- one active hold per seat per type
);

-- Partial unique: only one active hold per seat per event
CREATE UNIQUE INDEX idx_seat_holds_active
  ON seat_holds.seat_holds(event_id, seat_id)
  WHERE released_at IS NULL;

CREATE INDEX idx_seat_holds_event ON seat_holds.seat_holds(event_id);
CREATE INDEX idx_seat_holds_category ON seat_holds.seat_holds(category);
