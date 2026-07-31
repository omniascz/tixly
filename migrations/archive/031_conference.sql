-- Migration 031: Conference — multi-day pass, session management, speaker profiles

CREATE SCHEMA IF NOT EXISTS conference;

-- =============================================================================
-- conference.conferences
-- Extends catalog.events conceptually
-- =============================================================================
CREATE TABLE conference.conferences (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL,       -- FK → catalog.events.id (logical)
  subtitle            TEXT,
  venue_map_url       TEXT,
  website_url         TEXT,
  code_of_conduct_url TEXT,
  language            VARCHAR(10) NOT NULL DEFAULT 'cs',
  timezone            VARCHAR(50) NOT NULL DEFAULT 'Europe/Prague',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conference_conferences_event ON conference.conferences (event_id);

-- =============================================================================
-- conference.days
-- =============================================================================
CREATE TABLE conference.days (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id UUID NOT NULL,   -- FK → conference.conferences.id
  day_date      DATE NOT NULL,
  label         TEXT NOT NULL,   -- e.g. "Den 1"
  description   TEXT,
  sort_order    INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_conference_days_conference ON conference.days (conference_id, sort_order);

-- =============================================================================
-- conference.tracks
-- =============================================================================
CREATE TABLE conference.tracks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id UUID NOT NULL,       -- FK → conference.conferences.id
  name          TEXT NOT NULL,
  color         CHAR(7),             -- hex color, e.g. #FF5733
  description   TEXT,
  sort_order    INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_conference_tracks_conference ON conference.tracks (conference_id, sort_order);

-- =============================================================================
-- conference.sessions
-- =============================================================================
CREATE TABLE conference.sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id  UUID NOT NULL,   -- FK → conference.conferences.id
  day_id         UUID NOT NULL,   -- FK → conference.days.id
  track_id       UUID,            -- FK → conference.tracks.id (nullable)
  title          TEXT NOT NULL,
  description    TEXT,
  session_type   TEXT NOT NULL
                 CHECK (session_type IN ('talk','workshop','panel','keynote','break','networking')),
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ NOT NULL,
  room           TEXT,
  capacity       INT,
  is_recorded    BOOL NOT NULL DEFAULT false,
  slides_url     TEXT,
  video_url      TEXT,
  sort_order     INT NOT NULL DEFAULT 0,
  CONSTRAINT chk_session_time CHECK (ends_at > starts_at)
);

CREATE INDEX idx_conference_sessions_conference_starts ON conference.sessions (conference_id, starts_at);
CREATE INDEX idx_conference_sessions_day               ON conference.sessions (day_id);

-- =============================================================================
-- conference.speakers
-- =============================================================================
CREATE TABLE conference.speakers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID NOT NULL,   -- FK → platform.promoters.id
  full_name       TEXT NOT NULL,
  bio             TEXT,
  photo_url       TEXT,
  company         TEXT,
  title           TEXT,            -- job title
  linkedin_url    TEXT,
  twitter_handle  TEXT,
  website_url     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_speaker_promoter_name UNIQUE (promoter_id, full_name)
);

CREATE INDEX idx_conference_speakers_promoter ON conference.speakers (promoter_id);

-- =============================================================================
-- conference.session_speakers
-- =============================================================================
CREATE TABLE conference.session_speakers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL,   -- FK → conference.sessions.id
  speaker_id  UUID NOT NULL,   -- FK → conference.speakers.id
  role        TEXT NOT NULL
              CHECK (role IN ('speaker','moderator','panelist')),
  sort_order  INT NOT NULL DEFAULT 0,
  CONSTRAINT uq_session_speaker UNIQUE (session_id, speaker_id)
);

CREATE INDEX idx_conference_session_speakers_session ON conference.session_speakers (session_id);

-- =============================================================================
-- conference.multi_day_passes
-- =============================================================================
CREATE TABLE conference.multi_day_passes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL,   -- FK → catalog.events.id
  name             TEXT NOT NULL,
  description      TEXT,
  pass_type        TEXT NOT NULL
                   CHECK (pass_type IN ('full','day','track','workshop')),
  days_included    INT[] NOT NULL DEFAULT '{}',
  tracks_included  INT[],           -- nullable
  price_hellers    INT NOT NULL,    -- in halíře, never float
  sale_start       TIMESTAMPTZ,
  sale_end         TIMESTAMPTZ,
  quantity         INT,
  quantity_sold    INT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL
                   CHECK (status IN ('draft','active','sold_out','ended')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pass_quantity CHECK (quantity IS NULL OR quantity_sold <= quantity)
);

CREATE INDEX idx_conference_passes_event_status ON conference.multi_day_passes (event_id, status);

-- =============================================================================
-- conference.pass_activations
-- =============================================================================
CREATE TABLE conference.pass_activations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id       UUID NOT NULL,   -- FK → conference.multi_day_passes.id
  user_id       UUID NOT NULL,
  order_id      UUID,
  activated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_token  UUID NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT uq_pass_activation UNIQUE (pass_id, user_id)
);

CREATE UNIQUE INDEX idx_conference_pass_activations_token  ON conference.pass_activations (access_token);
CREATE        INDEX idx_conference_pass_activations_user   ON conference.pass_activations (user_id);
CREATE        INDEX idx_conference_pass_activations_pass   ON conference.pass_activations (pass_id);
