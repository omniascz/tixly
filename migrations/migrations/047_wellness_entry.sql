-- ============================================================================
-- Migration 047: Wellness Entry — waterparks, pools, spa zones & daily tickets
-- Schema: venues
-- ============================================================================

-- Wellness facilities (aquaparks, pools, spa, sauna worlds, thermal baths)
CREATE TABLE venues.wellness_facilities (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id    UUID NOT NULL,
  name           VARCHAR(200) NOT NULL,
  facility_type  VARCHAR(20) NOT NULL
                   CHECK(facility_type IN ('waterpark','pool','spa','wellness','thermal_bath','sauna_world')),
  address        TEXT,
  city           VARCHAR(100),
  description    TEXT,
  is_active      BOOL NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(promoter_id, name)
);

-- Zones within a facility (pools, saunas, slides, VIP areas, etc.)
CREATE TABLE venues.facility_zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id     UUID NOT NULL REFERENCES venues.wellness_facilities(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  zone_type       VARCHAR(20) NOT NULL
                    CHECK(zone_type IN ('pool','sauna','slide','hot_tub','steam_room','fitness','restaurant','vip')),
  description     TEXT,
  base_included   BOOL NOT NULL DEFAULT true,
  addon_price_hellers INT NOT NULL DEFAULT 0,
  capacity        INT NOT NULL,
  min_age         INT NOT NULL DEFAULT 0,
  sort_order      INT NOT NULL DEFAULT 0,
  is_active       BOOL NOT NULL DEFAULT true,
  UNIQUE(facility_id, name)
);

-- Daily ticket types (full day, half day, evening, etc.)
CREATE TABLE venues.daily_tickets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id           UUID NOT NULL REFERENCES venues.wellness_facilities(id) ON DELETE CASCADE,
  name                  VARCHAR(200) NOT NULL,
  ticket_type           VARCHAR(10) NOT NULL
                          CHECK(ticket_type IN ('full_day','half_day','evening','morning','weekend','annual')),
  valid_from_time       TIME,
  valid_until_time      TIME,
  price_hellers         INT NOT NULL,
  child_price_hellers   INT,
  senior_price_hellers  INT,
  included_zones        UUID[] NOT NULL DEFAULT '{}',
  max_capacity_per_day  INT,
  is_active             BOOL NOT NULL DEFAULT true,
  UNIQUE(facility_id, name)
);

-- Wellness bookings
CREATE TABLE venues.wellness_bookings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id           UUID NOT NULL REFERENCES venues.wellness_facilities(id),
  ticket_type_id        UUID NOT NULL REFERENCES venues.daily_tickets(id),
  visit_date            DATE NOT NULL,
  user_id               UUID NOT NULL,
  promoter_id           UUID NOT NULL,
  order_id              UUID,
  booking_ref           VARCHAR(20) NOT NULL UNIQUE,
  adult_count           INT NOT NULL DEFAULT 1,
  child_count           INT NOT NULL DEFAULT 0,
  senior_count          INT NOT NULL DEFAULT 0,
  addon_zone_ids        UUID[] NOT NULL DEFAULT '{}',
  base_price_hellers    INT NOT NULL,
  addons_price_hellers  INT NOT NULL DEFAULT 0,
  total_hellers         INT NOT NULL,
  status                VARCHAR(10) NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending','confirmed','cancelled','used','expired')),
  qr_token              UUID NOT NULL DEFAULT gen_random_uuid(),
  checked_in_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Daily capacity tracking per facility/date/ticket-type
CREATE TABLE venues.daily_capacity (
  facility_id     UUID NOT NULL REFERENCES venues.wellness_facilities(id),
  visit_date      DATE NOT NULL,
  ticket_type_id  UUID NOT NULL REFERENCES venues.daily_tickets(id),
  capacity        INT NOT NULL,
  booked_count    INT NOT NULL DEFAULT 0,
  is_closed       BOOL NOT NULL DEFAULT false,
  CONSTRAINT daily_capacity_count_check CHECK(booked_count <= capacity),
  PRIMARY KEY(facility_id, visit_date, ticket_type_id)
);

-- Locker reservations
CREATE TABLE venues.locker_reservations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wellness_booking_id UUID NOT NULL REFERENCES venues.wellness_bookings(id) ON DELETE CASCADE,
  facility_id         UUID NOT NULL,
  visit_date          DATE NOT NULL,
  locker_number       VARCHAR(20) NOT NULL,
  locker_type         VARCHAR(10) NOT NULL DEFAULT 'standard'
                        CHECK(locker_type IN ('standard','large','family')),
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(facility_id, visit_date, locker_number)
);

-- Indexes
CREATE INDEX idx_wellness_bookings_facility_date
  ON venues.wellness_bookings(facility_id, visit_date);

CREATE INDEX idx_wellness_bookings_user
  ON venues.wellness_bookings(user_id);

CREATE INDEX idx_wellness_bookings_qr_token
  ON venues.wellness_bookings(qr_token);

CREATE INDEX idx_daily_capacity_facility_date
  ON venues.daily_capacity(facility_id, visit_date);

CREATE INDEX idx_locker_reservations_booking
  ON venues.locker_reservations(wellness_booking_id);
