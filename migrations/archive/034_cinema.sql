-- =============================================================================
-- Migration 034: Cinema — screening management
-- Schema: cinema
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS cinema;

-- ---------------------------------------------------------------------------
-- cinema.venues
-- ---------------------------------------------------------------------------
CREATE TABLE cinema.venues (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id  UUID         NOT NULL,
  name         VARCHAR(255) NOT NULL,
  address      TEXT,
  city         VARCHAR(100),
  timezone     VARCHAR(50)  NOT NULL DEFAULT 'Europe/Prague',
  website_url  TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(promoter_id, name)
);

CREATE INDEX ON cinema.venues(promoter_id);

-- ---------------------------------------------------------------------------
-- cinema.auditoriums
-- ---------------------------------------------------------------------------
CREATE TABLE cinema.auditoriums (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id         UUID         NOT NULL REFERENCES cinema.venues(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  capacity         INT          NOT NULL CHECK(capacity > 0),
  has_3d           BOOL         NOT NULL DEFAULT false,
  has_imax         BOOL         NOT NULL DEFAULT false,
  has_dolby        BOOL         NOT NULL DEFAULT false,
  seating_map_url  TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id, name)
);

CREATE INDEX ON cinema.auditoriums(venue_id);

-- ---------------------------------------------------------------------------
-- cinema.films
-- ---------------------------------------------------------------------------
CREATE TABLE cinema.films (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id      UUID         NOT NULL,
  title            VARCHAR(500) NOT NULL,
  original_title   VARCHAR(500),
  synopsis         TEXT,
  duration_minutes INT          NOT NULL CHECK(duration_minutes > 0),
  language         VARCHAR(10)  NOT NULL DEFAULT 'cs',
  subtitles        VARCHAR(10),
  genre            VARCHAR(50),
  director         VARCHAR(255),
  cast_list        TEXT[]       NOT NULL DEFAULT '{}',
  poster_url       TEXT,
  trailer_url      TEXT,
  imdb_id          VARCHAR(20),
  release_year     INT,
  rating           VARCHAR(10),  -- e.g. '12+', '15+', 'U', 'PG'
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(promoter_id, imdb_id) WHERE imdb_id IS NOT NULL
);

CREATE INDEX ON cinema.films(promoter_id);
CREATE INDEX ON cinema.films(promoter_id, genre);

-- ---------------------------------------------------------------------------
-- cinema.screenings
-- ---------------------------------------------------------------------------
CREATE TABLE cinema.screenings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  film_id        UUID         NOT NULL REFERENCES cinema.films(id) ON DELETE RESTRICT,
  auditorium_id  UUID         NOT NULL REFERENCES cinema.auditoriums(id) ON DELETE RESTRICT,
  starts_at      TIMESTAMPTZ  NOT NULL,
  ends_at        TIMESTAMPTZ  NOT NULL,
  format         VARCHAR(10)  NOT NULL DEFAULT '2d' CHECK(format IN ('2d','3d','imax','4dx','dolby')),
  language       VARCHAR(10),
  subtitles      VARCHAR(10),
  price_hellers  INT          NOT NULL CHECK(price_hellers >= 0),
  status         VARCHAR(20)  NOT NULL DEFAULT 'scheduled'
                   CHECK(status IN ('scheduled','open','sold_out','cancelled','finished')),
  total_seats    INT          NOT NULL CHECK(total_seats > 0),
  seats_sold     INT          NOT NULL DEFAULT 0,
  notes          TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(auditorium_id, starts_at),
  CHECK(ends_at > starts_at),
  CHECK(seats_sold <= total_seats)
);

CREATE INDEX ON cinema.screenings(film_id);
CREATE INDEX ON cinema.screenings(auditorium_id, starts_at);
CREATE INDEX ON cinema.screenings(status, starts_at);

-- ---------------------------------------------------------------------------
-- cinema.screening_seats
-- ---------------------------------------------------------------------------
CREATE TABLE cinema.screening_seats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screening_id    UUID        NOT NULL REFERENCES cinema.screenings(id) ON DELETE CASCADE,
  row_label       VARCHAR(5)  NOT NULL,
  seat_number     INT         NOT NULL,
  seat_type       VARCHAR(20) NOT NULL DEFAULT 'standard'
                    CHECK(seat_type IN ('standard','vip','wheelchair','couple')),
  status          VARCHAR(20) NOT NULL DEFAULT 'available'
                    CHECK(status IN ('available','reserved','sold','blocked')),
  price_hellers   INT,
  order_id        UUID,
  reserved_until  TIMESTAMPTZ,
  UNIQUE(screening_id, row_label, seat_number)
);

CREATE INDEX ON cinema.screening_seats(screening_id, status);

-- ---------------------------------------------------------------------------
-- cinema.programs
-- ---------------------------------------------------------------------------
CREATE TABLE cinema.programs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     UUID  NOT NULL REFERENCES cinema.venues(id) ON DELETE CASCADE,
  week_start   DATE  NOT NULL,  -- Monday of the week
  published_at TIMESTAMPTZ,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id, week_start)
);

CREATE INDEX ON cinema.programs(venue_id, week_start);

-- ---------------------------------------------------------------------------
-- cinema.program_screenings
-- ---------------------------------------------------------------------------
CREATE TABLE cinema.program_screenings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id   UUID NOT NULL REFERENCES cinema.programs(id) ON DELETE CASCADE,
  screening_id UUID NOT NULL REFERENCES cinema.screenings(id) ON DELETE CASCADE,
  UNIQUE(program_id, screening_id)
);

CREATE INDEX ON cinema.program_screenings(program_id);
CREATE INDEX ON cinema.program_screenings(screening_id);

COMMIT;
