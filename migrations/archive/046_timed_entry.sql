-- Migration 046: Timed Entry — Muzea, galerie, ZOO, botanické zahrady
-- Module #93

CREATE SCHEMA IF NOT EXISTS venues;

-- ---------------------------------------------------------------------------
-- venues.cultural_venues
-- ---------------------------------------------------------------------------
CREATE TABLE venues.cultural_venues (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id    UUID NOT NULL,
  name           VARCHAR(200) NOT NULL,
  venue_type     VARCHAR(50) NOT NULL CHECK (venue_type IN (
                   'museum','gallery','zoo','botanical_garden',
                   'national_park','historic_site','aquarium','planetarium'
                 )),
  address        TEXT,
  city           VARCHAR(100),
  description    TEXT,
  website_url    TEXT,
  google_maps_url TEXT,
  accessibility_info TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (promoter_id, name)
);

CREATE INDEX idx_cultural_venues_promoter ON venues.cultural_venues (promoter_id);
CREATE INDEX idx_cultural_venues_type     ON venues.cultural_venues (venue_type);
CREATE INDEX idx_cultural_venues_city     ON venues.cultural_venues (city);

-- ---------------------------------------------------------------------------
-- venues.venue_zones
-- ---------------------------------------------------------------------------
CREATE TABLE venues.venue_zones (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                 UUID NOT NULL REFERENCES venues.cultural_venues (id) ON DELETE CASCADE,
  name                     VARCHAR(200) NOT NULL,
  description              TEXT,
  capacity                 INTEGER NOT NULL,
  requires_separate_ticket BOOLEAN NOT NULL DEFAULT false,
  additional_price_hellers INTEGER NOT NULL DEFAULT 0,
  sort_order               INTEGER NOT NULL DEFAULT 0,
  is_active                BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (venue_id, name)
);

CREATE INDEX idx_venue_zones_venue ON venues.venue_zones (venue_id);

-- ---------------------------------------------------------------------------
-- venues.ticket_types
-- ---------------------------------------------------------------------------
CREATE TABLE venues.ticket_types (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id         UUID NOT NULL REFERENCES venues.cultural_venues (id) ON DELETE CASCADE,
  name             VARCHAR(200) NOT NULL,
  price_hellers    INTEGER NOT NULL,
  age_min          INTEGER NOT NULL DEFAULT 0,
  age_max          INTEGER NOT NULL DEFAULT 999,
  max_per_booking  INTEGER NOT NULL DEFAULT 10,
  requires_id      BOOLEAN NOT NULL DEFAULT false,
  description      TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (venue_id, name)
);

CREATE INDEX idx_ticket_types_venue ON venues.ticket_types (venue_id);

-- ---------------------------------------------------------------------------
-- venues.entry_slots
-- ---------------------------------------------------------------------------
CREATE TABLE venues.entry_slots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     UUID NOT NULL REFERENCES venues.cultural_venues (id) ON DELETE CASCADE,
  slot_date    DATE NOT NULL,
  entry_time   TIME NOT NULL,
  exit_time    TIME NOT NULL,
  capacity     INTEGER NOT NULL,
  booked_count INTEGER NOT NULL DEFAULT 0,
  status       VARCHAR(20) NOT NULL DEFAULT 'available'
               CHECK (status IN ('available','full','closed','cancelled')),
  notes        TEXT,
  UNIQUE (venue_id, slot_date, entry_time)
);

CREATE INDEX idx_entry_slots_venue_date ON venues.entry_slots (venue_id, slot_date);
CREATE INDEX idx_entry_slots_status     ON venues.entry_slots (status);

-- ---------------------------------------------------------------------------
-- venues.entry_bookings
-- ---------------------------------------------------------------------------
CREATE TABLE venues.entry_bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_slot_id   UUID NOT NULL REFERENCES venues.entry_slots (id),
  user_id         UUID NOT NULL,
  promoter_id     UUID NOT NULL,
  order_id        UUID,
  booking_ref     VARCHAR(20) NOT NULL UNIQUE,
  ticket_lines    JSONB NOT NULL DEFAULT '[]',
  total_visitors  INTEGER NOT NULL,
  total_hellers   INTEGER NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','cancelled','used','expired')),
  qr_token        UUID NOT NULL DEFAULT gen_random_uuid(),
  checked_in_at   TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entry_slot_id, user_id)
);

CREATE INDEX idx_entry_bookings_slot    ON venues.entry_bookings (entry_slot_id);
CREATE INDEX idx_entry_bookings_user    ON venues.entry_bookings (user_id);
CREATE INDEX idx_entry_bookings_ref     ON venues.entry_bookings (booking_ref);
CREATE INDEX idx_entry_bookings_qr      ON venues.entry_bookings (qr_token);
CREATE INDEX idx_entry_bookings_status  ON venues.entry_bookings (status);

-- ---------------------------------------------------------------------------
-- venues.zone_access
-- ---------------------------------------------------------------------------
CREATE TABLE venues.zone_access (
  entry_booking_id UUID NOT NULL REFERENCES venues.entry_bookings (id) ON DELETE CASCADE,
  zone_id          UUID NOT NULL REFERENCES venues.venue_zones (id),
  is_included      BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (entry_booking_id, zone_id)
);

CREATE INDEX idx_zone_access_booking ON venues.zone_access (entry_booking_id);
