-- Migration 117: Find My Friends — Location sharing (Feature #58)
-- Fanoušci si sdílejí polohu ve venue (privacy-first, opt-in).

CREATE SCHEMA IF NOT EXISTS venue_features;

-- Vyžaduje PostGIS pro ST_DWithin proximity search
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE venue_features.friend_locations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL,              -- ref: catalog.events(id)
  user_id           UUID NOT NULL,              -- kupující
  user_display_name TEXT NOT NULL,              -- přezdívka (non-identifiable)
  latitude          NUMERIC(10, 8) NOT NULL,   -- WGS84
  longitude         NUMERIC(11, 8) NOT NULL,   -- WGS84
  accuracy          INTEGER,                    -- meters
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, user_id)
);

-- PostGIS index pro proximity search
CREATE INDEX idx_friend_locations_geom ON venue_features.friend_locations
  USING GIST(ST_Point(longitude, latitude)::geography);

CREATE INDEX idx_friend_locations_event ON venue_features.friend_locations (event_id);
CREATE INDEX idx_friend_locations_active ON venue_features.friend_locations (event_id)
  WHERE last_seen_at > NOW() - INTERVAL '5 minutes';
