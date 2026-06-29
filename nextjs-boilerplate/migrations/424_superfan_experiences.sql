-- Migration 424: Super Fan Experiences — Meet & Greet, VIP Soundcheck, Backstage Tour
-- Bookable premium zážitky ke vstupenkovým akcím (kapacitně omezené, placené).
-- Promotér vytvoří slot; kupující si přikoupí při nebo po koupi vstupenky.

CREATE TABLE IF NOT EXISTS catalog.superfan_experiences (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid        NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  name              text        NOT NULL,   -- "Meet & Greet", "VIP Soundcheck", "Backstage Tour"
  description       text,
  type              text        NOT NULL DEFAULT 'meet_greet',
  -- meet_greet | soundcheck | backstage_tour | vip_lounge | after_party
  capacity          int         NOT NULL DEFAULT 10,
  reserved_count    int         NOT NULL DEFAULT 0,
  price_halire      int         NOT NULL DEFAULT 0,  -- 0 = zdarma pro držitele VIP vstupenky
  currency          char(3)     NOT NULL DEFAULT 'CZK',
  requires_ticket   boolean     NOT NULL DEFAULT true,  -- jen pro držitele vstupenky
  start_time        timestamptz,   -- čas začátku zážitku (může se lišit od akce)
  location          text,          -- "Backstage, vchod B"
  what_to_expect    text,          -- detailní popis co se bude dít
  cover_image_url   text,
  active            boolean     NOT NULL DEFAULT true,
  booking_deadline  timestamptz,   -- uzávěrka rezervací
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS superfan_exp_event_idx ON catalog.superfan_experiences (event_id, active);

-- Bookings — záznamy rezervací
CREATE TABLE IF NOT EXISTS orders.superfan_bookings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  experience_id     uuid        NOT NULL REFERENCES catalog.superfan_experiences(id) ON DELETE CASCADE,
  order_id          uuid        NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES identity.users(id),
  confirmation_code text        NOT NULL DEFAULT ('SFE-' || upper(substr(gen_random_uuid()::text, 1, 8))),
  status            text        NOT NULL DEFAULT 'confirmed',  -- confirmed | cancelled | attended
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS superfan_bookings_order_exp_idx
  ON orders.superfan_bookings (order_id, experience_id);

-- Atomické kapacitní řízení
ALTER TABLE catalog.superfan_experiences
  ADD CONSTRAINT superfan_capacity_check CHECK (reserved_count <= capacity OR capacity = 0);

-- RLS
ALTER TABLE catalog.superfan_experiences ENABLE ROW LEVEL SECURITY;
CREATE POLICY superfan_exp_public_read ON catalog.superfan_experiences
  FOR SELECT USING (true);
CREATE POLICY superfan_exp_promoter_write ON catalog.superfan_experiences
  FOR ALL USING (
    event_id IN (
      SELECT id FROM catalog.events
      WHERE promoter_id::text = current_setting('app.current_promoter_id', true)
    )
  );

ALTER TABLE orders.superfan_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY superfan_bookings_own ON orders.superfan_bookings
  FOR SELECT USING (
    user_id::text = current_setting('app.current_user_id', true)
    OR current_setting('app.is_platform_admin', true) = 'true'
  );
CREATE POLICY superfan_bookings_insert ON orders.superfan_bookings
  FOR INSERT WITH CHECK (
    user_id::text = current_setting('app.current_user_id', true)
  );
