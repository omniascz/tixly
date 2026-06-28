-- Parking & Ubytování Bundle
-- Promotér může ke každé akci přidat rezervace parkovacích míst a hotelů.
-- Zákazník si bundle přikoupí při checkoutu; dostane confirmation code (QR).

-- ─── Parkovací nabídky ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog.parking_offers (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id            uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  name                text NOT NULL,               -- "Parkoviště P1 – 200 m od vstupu"
  description         text,
  address             text,
  lat                 numeric(10,7),
  lng                 numeric(10,7),
  distance_meters     int,                         -- vzdálenost od vstupu do akce
  vehicle_types       text[] DEFAULT ARRAY['car'], -- car | motorcycle | bus | ev
  height_limit_cm     int,                         -- max výška vozidla (parkovací dům)
  price_halire        int NOT NULL DEFAULT 0,
  capacity            int NOT NULL DEFAULT 0,
  access_instructions text,                        -- "Vjezd z ul. XY, brána č. 3, QR na závoru"
  booking_deadline    timestamptz,                 -- po tomto čase nelze rezervovat
  confirmation_prefix text NOT NULL DEFAULT 'PKG', -- PKG-XXXXXX
  active              boolean NOT NULL DEFAULT true,
  sort_order          int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parking_event ON catalog.parking_offers(event_id, sort_order);

-- ─── Ubytovací nabídky ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog.accommodation_offers (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id                 uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  name                     text NOT NULL,           -- "Hotel Marriott Praha – 500 m"
  description              text,
  address                  text,
  lat                      numeric(10,7),
  lng                      numeric(10,7),
  distance_meters          int,
  stars                    smallint CHECK(stars BETWEEN 1 AND 5),
  room_type                text NOT NULL DEFAULT 'double', -- single|double|twin|suite
  breakfast_included       boolean NOT NULL DEFAULT false,
  price_per_night_halire   int NOT NULL DEFAULT 0,
  base_nights              smallint NOT NULL DEFAULT 1,    -- počet nocí v balíčku
  check_in_date            date,
  check_out_date           date,
  partner_url              text,                   -- affiliate / přímý odkaz na booking
  cancellation_policy      text,                   -- "Storno zdarma do 48 h před příjezdem"
  active                   boolean NOT NULL DEFAULT true,
  sort_order               int NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accommodation_event ON catalog.accommodation_offers(event_id, sort_order);

-- ─── Zakoupené bundle položky ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders.bundle_items (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id             uuid NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
  item_type            text NOT NULL CHECK (item_type IN ('parking','accommodation')),
  -- offer_id ukazuje na příslušnou tabulku dle item_type
  parking_offer_id     uuid REFERENCES catalog.parking_offers(id) ON DELETE SET NULL,
  accommodation_offer_id uuid REFERENCES catalog.accommodation_offers(id) ON DELETE SET NULL,
  quantity             smallint NOT NULL DEFAULT 1,
  nights               smallint,                  -- jen pro accommodation
  unit_price_halire    int NOT NULL DEFAULT 0,
  total_price_halire   int NOT NULL DEFAULT 0,
  confirmation_code    text UNIQUE,               -- unikátní kód pro QR (vjezd / hotel voucher)
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bundle_items_order ON orders.bundle_items(order_id);

-- Kapacita parkování: atomický reserved_count
ALTER TABLE catalog.parking_offers
  ADD COLUMN IF NOT EXISTS reserved_count int NOT NULL DEFAULT 0;

-- RLS
ALTER TABLE catalog.parking_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY parking_offers_svc ON catalog.parking_offers
  USING (current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE catalog.accommodation_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY accommodation_offers_svc ON catalog.accommodation_offers
  USING (current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE orders.bundle_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY bundle_items_svc ON orders.bundle_items
  USING (current_setting('app.bypass_rls', true) = 'on');

-- Veřejné čtení parking/accommodation (pro checkout)
CREATE POLICY parking_offers_public_read ON catalog.parking_offers
  FOR SELECT USING (active = true);

CREATE POLICY accommodation_offers_public_read ON catalog.accommodation_offers
  FOR SELECT USING (active = true);
