-- =============================================================================
-- Migration 147: Virtual Venue — 3D Seat Preview
-- Feature #42: Interactive 3D preview of seat views before purchase
--              Reduces complaints, increases conversion for premium seats
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS virtual_venue;

-- Section panorama: 360° photosphere for a seating section
CREATE TABLE IF NOT EXISTS virtual_venue.section_panoramas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            TEXT NOT NULL,           -- venue identifier (not FK — static asset reference)
  section_id          TEXT NOT NULL,           -- matches Section.id in seat-map
  panorama_url        TEXT NOT NULL,           -- equirectangular 360° image URL
  thumbnail_url       TEXT,
  fov_degrees         INT NOT NULL DEFAULT 90 CHECK (fov_degrees BETWEEN 30 AND 180),
  pitch_degrees       DECIMAL(5,2) NOT NULL DEFAULT 0,  -- default camera pitch
  yaw_degrees         DECIMAL(6,2) NOT NULL DEFAULT 0,  -- default camera yaw (facing stage)
  label               TEXT,                   -- e.g. "Section A — Side View"
  uploaded_by         UUID NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (venue_id, section_id)
);

-- Per-seat preview: individual seat view images (for premium/unique seats)
CREATE TABLE IF NOT EXISTS virtual_venue.seat_previews (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            TEXT NOT NULL,
  seat_id             TEXT NOT NULL,           -- matches Seat.id in seat-map
  preview_url         TEXT NOT NULL,           -- seat view photo or render
  thumbnail_url       TEXT,
  view_description    TEXT,                   -- "Clear view of stage, front-left angle"
  view_quality        TEXT NOT NULL DEFAULT 'standard'
                        CHECK (view_quality IN ('standard', 'good', 'excellent', 'obstructed')),
  uploaded_by         UUID NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (venue_id, seat_id)
);

CREATE INDEX idx_section_panoramas_venue ON virtual_venue.section_panoramas(venue_id);
CREATE INDEX idx_seat_previews_venue ON virtual_venue.seat_previews(venue_id);
