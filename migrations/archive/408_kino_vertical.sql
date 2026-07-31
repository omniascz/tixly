-- Migration 408: Kino vertikál — cinema ticketing (analogie kinoheld / Eventim Cinema)
--
-- Architektura:
--   catalog.films          — filmový katalog (metadata, poster, věkové omezení)
--   catalog.cinema_screens — promítací sály uvnitř kina (venue_id FK)
--   catalog.events         — každé promítání = jeden event
--                            (film_id + cinema_screen_id + is_screening)
--
-- Reusuje: checkout, tickets, ticket_types, event_seats, foyer_items (občerstvení).

-- ─── Filmový katalog ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog.films (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id      uuid          REFERENCES platform.promoters(id),  -- NULL = sdílený katalog
  title            text          NOT NULL,
  original_title   text,
  synopsis         text,
  poster_url       text,
  backdrop_url     text,
  trailer_url      text,
  duration_minutes smallint      NOT NULL CHECK (duration_minutes BETWEEN 1 AND 600),
  age_rating       text          NOT NULL DEFAULT 'U'
                                 CHECK (age_rating IN ('U','7','12','15','18','X')),
  genre            text[]        NOT NULL DEFAULT '{}',
  director         text,
  cast_main        text,          -- hlavní herci, odděleni čárkou
  language         text          NOT NULL DEFAULT 'cs',  -- ISO 639-1
  original_language text,
  country          text,
  release_year     smallint,
  imdb_id          text,
  tmdb_id          text,
  distributor      text,
  status           text          NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active','archived','upcoming')),
  created_at       timestamptz   NOT NULL DEFAULT NOW(),
  updated_at       timestamptz   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_films_promoter  ON catalog.films (promoter_id);
CREATE INDEX IF NOT EXISTS idx_films_status    ON catalog.films (status);

-- ─── Kino sály (screens) ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog.cinema_screens (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id       uuid        NOT NULL REFERENCES catalog.venues(id),
  name           text        NOT NULL,           -- "Velký sál", "IMAX", "Sál 2"
  capacity       smallint    NOT NULL CHECK (capacity BETWEEN 1 AND 2000),
  screen_type    text        NOT NULL DEFAULT 'standard'
                             CHECK (screen_type IN
                               ('standard','dolby_atmos','imax','4dx','vip','outdoor','drive_in')),
  has_3d         boolean     NOT NULL DEFAULT false,
  is_accessible  boolean     NOT NULL DEFAULT false,
  sort_order     smallint    NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cinema_screens_venue ON catalog.cinema_screens (venue_id);

-- ─── Rozšíření catalog.events o kino sloupce ───────────────────────────────

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS is_screening       boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS film_id            uuid     REFERENCES catalog.films(id),
  ADD COLUMN IF NOT EXISTS cinema_screen_id   uuid     REFERENCES catalog.cinema_screens(id),
  ADD COLUMN IF NOT EXISTS screening_format   text     CHECK (screening_format IN
    ('2d','3d','imax','4dx','dubbed','subtitled','original','dubbed_3d','subtitled_3d')),
  ADD COLUMN IF NOT EXISTS screening_language text;    -- např. 'cs' pro dabing, 'en' pro orig.

CREATE INDEX IF NOT EXISTS idx_events_film_id ON catalog.events (film_id)
  WHERE film_id IS NOT NULL;

COMMENT ON COLUMN catalog.events.is_screening IS
  'true = kino promítání; reusuje celý event+ticket+seat stack';
COMMENT ON COLUMN catalog.events.film_id IS
  'FK na catalog.films; NULL pro regulérní eventy';
