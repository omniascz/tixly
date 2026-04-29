-- =============================================================================
-- Migration 131: Event Lineup — Artist Profiles & External Platform Links
-- Schema: events (extends catalog.events)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS lineups;

-- Artist profiles for event lineups
CREATE TABLE lineups.artists (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES catalog.events(id),
  promoter_id       UUID NOT NULL,  -- tenant scoping
  name              TEXT NOT NULL,
  bio               TEXT,
  image_url         TEXT,
  stage_order       INT,
  stage_name        TEXT,
  performance_time  TIME,
  performance_date  DATE,
  genre_tags        TEXT[],  -- e.g., ['rock', 'alternative']
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, name)
);

-- External platform profile links
CREATE TABLE lineups.artist_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id         UUID NOT NULL REFERENCES lineups.artists(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL CHECK (platform IN ('spotify', 'bandsintown', 'songkick')),
  profile_id        TEXT NOT NULL,
  profile_url       TEXT,
  follower_count    INT DEFAULT 0,
  monthly_listeners INT DEFAULT 0,
  popularity_score  INT DEFAULT 0,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(artist_id, platform)
);

-- Indexes
CREATE INDEX idx_artists_event_id ON lineups.artists(event_id);
CREATE INDEX idx_artists_promoter_event ON lineups.artists(promoter_id, event_id);
CREATE INDEX idx_artists_stage_order ON lineups.artists(event_id, stage_order);
CREATE INDEX idx_artist_profiles_artist ON lineups.artist_profiles(artist_id);
