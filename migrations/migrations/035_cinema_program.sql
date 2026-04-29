-- Migration 035: Cinema Program — age restrictions & program extensions
-- Module: @tixly/cinema-program

-- ---------------------------------------------------------------------------
-- age_restriction_rules
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cinema.age_restriction_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id   UUID NOT NULL,
  rating        VARCHAR(10) NOT NULL,
  min_age       INT NOT NULL,
  requires_id_check BOOL NOT NULL DEFAULT false,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (promoter_id, rating)
);

-- ---------------------------------------------------------------------------
-- age_verifications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cinema.age_verifications (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screening_id         UUID NOT NULL REFERENCES cinema.screenings(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL,
  verified_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method               VARCHAR(20) NOT NULL CHECK (method IN ('self_declared', 'bankid', 'ocr')),
  birth_date           DATE NOT NULL,
  age_at_verification  INT NOT NULL,
  UNIQUE (screening_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_age_verifications_user_id
  ON cinema.age_verifications (user_id);

-- ---------------------------------------------------------------------------
-- film_releases
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cinema.film_releases (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  film_id             UUID NOT NULL REFERENCES cinema.films(id) ON DELETE CASCADE,
  venue_id            UUID NOT NULL REFERENCES cinema.venues(id) ON DELETE CASCADE,
  release_date        DATE NOT NULL,
  end_date            DATE,
  status              VARCHAR(15) NOT NULL CHECK (status IN ('coming_soon', 'now_showing', 'ended')) DEFAULT 'coming_soon',
  poster_override_url TEXT,
  promo_text          TEXT,
  UNIQUE (film_id, venue_id)
);

CREATE INDEX IF NOT EXISTS idx_film_releases_venue_status
  ON cinema.film_releases (venue_id, status);

CREATE INDEX IF NOT EXISTS idx_film_releases_release_date
  ON cinema.film_releases (release_date);

CREATE INDEX IF NOT EXISTS idx_film_releases_end_date
  ON cinema.film_releases (end_date);

-- ---------------------------------------------------------------------------
-- screening_tags
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cinema.screening_tags (
  screening_id  UUID NOT NULL REFERENCES cinema.screenings(id) ON DELETE CASCADE,
  tag           VARCHAR(50) NOT NULL,
  PRIMARY KEY (screening_id, tag),
  UNIQUE (screening_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_screening_tags_screening_id
  ON cinema.screening_tags (screening_id);

-- ---------------------------------------------------------------------------
-- widget_configs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cinema.widget_configs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id       UUID NOT NULL REFERENCES cinema.venues(id) ON DELETE CASCADE,
  config_key     VARCHAR(50) NOT NULL,
  days_ahead     INT NOT NULL DEFAULT 7,
  show_sold_out  BOOL NOT NULL DEFAULT true,
  show_prices    BOOL NOT NULL DEFAULT true,
  primary_color  CHAR(7) NOT NULL DEFAULT '#1a1a2e',
  accent_color   CHAR(7) NOT NULL DEFAULT '#e94560',
  custom_css     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (venue_id, config_key)
);
