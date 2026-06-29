-- Migration 414: EVENTIM.Travel — ticket + hotel bundles
-- Hotel catalog (venue-level), room types, event packages, order bookings.

-- ── Hotel catalog ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog.travel_hotels (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid        REFERENCES catalog.venues(id) ON DELETE SET NULL,
  name          text        NOT NULL,
  address       text,
  city          text,
  stars         smallint    CHECK (stars BETWEEN 1 AND 5),
  description   text,
  amenities     jsonb       NOT NULL DEFAULT '[]',
  cover_image_url text,
  website_url   text,
  active        boolean     NOT NULL DEFAULT true,
  created_by    uuid        REFERENCES identity.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_travel_hotels_venue ON catalog.travel_hotels (venue_id);

-- ── Room types per hotel ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog.travel_hotel_rooms (
  id                    uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id              uuid    NOT NULL REFERENCES catalog.travel_hotels(id) ON DELETE CASCADE,
  name                  text    NOT NULL,
  capacity              int     NOT NULL DEFAULT 2,
  price_per_night_halire int    NOT NULL CHECK (price_per_night_halire >= 0),
  breakfast_included    boolean NOT NULL DEFAULT false,
  description           text,
  sort_order            int     NOT NULL DEFAULT 0,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_travel_hotel_rooms_hotel ON catalog.travel_hotel_rooms (hotel_id);

-- ── Event-level travel package: links event to a room at specific dates ────────
-- Promoter adds this for their event; buyer picks during checkout.
CREATE TABLE IF NOT EXISTS catalog.event_travel_packages (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid    NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  hotel_id            uuid    NOT NULL REFERENCES catalog.travel_hotels(id),
  hotel_room_id       uuid    NOT NULL REFERENCES catalog.travel_hotel_rooms(id),
  checkin_date        date    NOT NULL,
  checkout_date       date    NOT NULL,
  nights              int     GENERATED ALWAYS AS (checkout_date - checkin_date) STORED,
  total_capacity      int     NOT NULL DEFAULT 0, -- 0 = unlimited
  reserved_count      int     NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  price_per_night_override_halire int, -- NULL = use room's base price
  active              boolean NOT NULL DEFAULT true,
  display_order       int     NOT NULL DEFAULT 0,
  created_by          uuid    REFERENCES identity.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (checkout_date > checkin_date),
  CHECK (total_capacity = 0 OR reserved_count <= total_capacity)
);

CREATE INDEX IF NOT EXISTS idx_event_travel_packages_event ON catalog.event_travel_packages (event_id);
CREATE INDEX IF NOT EXISTS idx_event_travel_packages_hotel ON catalog.event_travel_packages (hotel_id);

-- ── Order travel bookings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders.travel_bookings (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid    NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
  package_id          uuid    NOT NULL REFERENCES catalog.event_travel_packages(id),
  -- Denormalized snapshot (hotel may be edited after booking)
  hotel_name          text    NOT NULL,
  hotel_address       text,
  hotel_stars         smallint,
  room_name           text    NOT NULL,
  checkin_date        date    NOT NULL,
  checkout_date       date    NOT NULL,
  nights              int     NOT NULL,
  guests              int     NOT NULL DEFAULT 1 CHECK (guests BETWEEN 1 AND 10),
  price_per_night_halire int  NOT NULL,
  total_price_halire  int     NOT NULL,
  -- Confirmation code shown on ticket + email (e.g. TXL-HTL-A3B9C2)
  confirmation_code   text    UNIQUE,
  guest_notes         text,
  status              text    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_travel_bookings_order ON orders.travel_bookings (order_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE catalog.travel_hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.travel_hotel_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.event_travel_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.travel_bookings ENABLE ROW LEVEL SECURITY;

-- Hotels: public read; platform admin write
CREATE POLICY travel_hotels_select ON catalog.travel_hotels FOR SELECT USING (true);
CREATE POLICY travel_hotels_write ON catalog.travel_hotels
  FOR ALL USING (current_setting('app.is_platform_admin', true) = 'true');

-- Rooms: public read; platform admin write
CREATE POLICY travel_hotel_rooms_select ON catalog.travel_hotel_rooms FOR SELECT USING (true);
CREATE POLICY travel_hotel_rooms_write ON catalog.travel_hotel_rooms
  FOR ALL USING (current_setting('app.is_platform_admin', true) = 'true');

-- Packages: public read; platform admin OR event-owner promoter write
CREATE POLICY event_travel_packages_select ON catalog.event_travel_packages FOR SELECT USING (true);
CREATE POLICY event_travel_packages_write ON catalog.event_travel_packages
  FOR ALL USING (
    current_setting('app.is_platform_admin', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM catalog.events e
       JOIN identity.promoter_members pm ON pm.promoter_id = e.promoter_id
      WHERE e.id = event_id
        AND pm.user_id::text = current_setting('app.user_id', true)
    )
  );

-- Bookings: buyer sees own; platform admin sees all
CREATE POLICY travel_bookings_select ON orders.travel_bookings FOR SELECT USING (
  current_setting('app.is_platform_admin', true) = 'true'
  OR EXISTS (
    SELECT 1 FROM orders.orders o WHERE o.id = order_id
      AND o.user_id::text = current_setting('app.user_id', true)
  )
);
CREATE POLICY travel_bookings_insert ON orders.travel_bookings FOR INSERT WITH CHECK (true);
CREATE POLICY travel_bookings_update ON orders.travel_bookings FOR UPDATE USING (
  current_setting('app.is_platform_admin', true) = 'true'
);
