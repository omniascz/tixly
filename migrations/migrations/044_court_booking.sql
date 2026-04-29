-- =============================================================================
-- Migration 044: Court & Green Booking
-- Module: court-booking
-- Schema: venues
-- =============================================================================

-- Sports clubs
CREATE TABLE venues.sports_clubs (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID         NOT NULL,
  name            VARCHAR(200) NOT NULL,
  sport_types     TEXT[]       NOT NULL,
  address         TEXT,
  city            VARCHAR(100),
  has_indoor      BOOL         NOT NULL DEFAULT false,
  has_outdoor     BOOL         NOT NULL DEFAULT false,
  has_lighting    BOOL         NOT NULL DEFAULT false,
  has_pro_shop    BOOL         NOT NULL DEFAULT false,
  has_coaching    BOOL         NOT NULL DEFAULT false,
  is_active       BOOL         NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (promoter_id, name)
);

-- Courts / tee times / driving range bays
CREATE TABLE venues.courts (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id               UUID         NOT NULL REFERENCES venues.sports_clubs (id) ON DELETE CASCADE,
  resource_id           UUID,        -- FK reservations.resources (nullable if not yet linked)
  name                  VARCHAR(100) NOT NULL,
  sport_type            TEXT         NOT NULL CHECK (sport_type IN ('tennis','squash','padel','badminton','golf_tee','golf_range')),
  surface               TEXT         NOT NULL DEFAULT 'hard' CHECK (surface IN ('clay','hard','grass','artificial_grass','indoor_carpet','synthetic')),
  is_indoor             BOOL         NOT NULL DEFAULT false,
  has_lighting          BOOL         NOT NULL DEFAULT false,
  max_players           INT          NOT NULL DEFAULT 4,
  slot_duration_minutes INT          NOT NULL DEFAULT 60,
  price_hellers         INT          NOT NULL,
  peak_price_hellers    INT,
  peak_hours_start      TIME         NOT NULL DEFAULT '17:00',
  peak_hours_end        TIME         NOT NULL DEFAULT '21:00',
  is_active             BOOL         NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (club_id, name)
);

-- Court bookings
CREATE TABLE venues.court_bookings (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id            UUID        NOT NULL REFERENCES venues.courts (id) ON DELETE CASCADE,
  slot_id             UUID,       -- FK reservations.slots
  booking_id          UUID,       -- FK reservations.bookings
  player_names        TEXT[]      NOT NULL DEFAULT '{}',
  is_coaching_session BOOL        NOT NULL DEFAULT false,
  coach_id            UUID,
  equipment_rental    TEXT[]      NOT NULL DEFAULT '{}',
  notes               TEXT,
  status              TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','completed','cancelled','no_show')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Membership cards
CREATE TABLE venues.membership_cards (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id              UUID        NOT NULL REFERENCES venues.sports_clubs (id) ON DELETE CASCADE,
  user_id              UUID        NOT NULL,
  card_type            TEXT        NOT NULL CHECK (card_type IN ('basic','premium','family','junior','senior')),
  valid_from           DATE        NOT NULL,
  valid_until          DATE        NOT NULL,
  discount_percentage  INT         NOT NULL DEFAULT 0 CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
  max_bookings_per_week INT        NOT NULL DEFAULT 7,
  bookings_this_week   INT         NOT NULL DEFAULT 0,
  week_reset_at        DATE,
  is_active            BOOL        NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (club_id, user_id, card_type)
);

-- Guest passes
CREATE TABLE venues.guest_passes (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id            UUID        NOT NULL REFERENCES venues.sports_clubs (id) ON DELETE CASCADE,
  issued_to_user_id  UUID        NOT NULL,
  issued_by_user_id  UUID        NOT NULL,
  valid_date         DATE        NOT NULL,
  used_at            TIMESTAMPTZ,
  is_used            BOOL        NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_courts_club_sport   ON venues.courts          (club_id, sport_type);
CREATE INDEX idx_court_bookings_court ON venues.court_bookings  (court_id);
CREATE INDEX idx_court_bookings_booking ON venues.court_bookings (booking_id);
CREATE INDEX idx_membership_club_user ON venues.membership_cards (club_id, user_id);
CREATE INDEX idx_membership_user_active ON venues.membership_cards (user_id, is_active);
