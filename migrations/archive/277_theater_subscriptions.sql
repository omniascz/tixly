-- 277_theater_subscriptions.sql
-- Divadelní abonentky (subscriptions / season tickets) — klíčový CZ vertikál.
-- Tradiční model: divadlo vystavuje balíčky X představení za sezónu, předplatitel
-- má rezervované konkrétní sedadlo na všechna představení v balíčku.

BEGIN;

CREATE SCHEMA IF NOT EXISTS subscriptions;

-- 1. Definice balíčku (sezónní permanentka)
CREATE TABLE IF NOT EXISTS subscriptions.packages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id       uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  venue_id          uuid REFERENCES catalog.venues(id) ON DELETE SET NULL,
  name              text NOT NULL,                -- "Pondělní abonentka 2026/27"
  slug              text NOT NULL,                -- "pondelni-2026-27"
  description       text,
  season_label      text NOT NULL,                -- "2026/27"
  category          text NOT NULL DEFAULT 'theater'  -- theater | concert_series | dance | other
                      CHECK (category IN ('theater', 'concert_series', 'dance', 'children', 'other')),

  -- Pricing
  base_price_halire integer NOT NULL CHECK (base_price_halire > 0),
  currency          text NOT NULL DEFAULT 'CZK',
  early_bird_until  timestamptz,                  -- před tímto datem cena = early_bird_price
  early_bird_price_halire integer,                -- volitelně sleva pro early adopters

  -- Sale window
  sale_start        timestamptz NOT NULL DEFAULT now(),
  sale_end          timestamptz,                  -- NULL = otevřené
  capacity          integer,                       -- max počet abonentek (NULL = unlimited)

  -- Renewal
  auto_renewable    boolean NOT NULL DEFAULT true,
  renewal_priority_days integer NOT NULL DEFAULT 14, -- kolik dní mají existující abonenti přednost
                                                     -- před general public sale na další sezónu

  -- Lifecycle
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'on_sale', 'sold_out', 'closed', 'archived')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_subscriptions_packages_slug UNIQUE (promoter_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_subs_packages_promoter ON subscriptions.packages(promoter_id, status);
CREATE INDEX IF NOT EXISTS idx_subs_packages_season ON subscriptions.packages(season_label);

-- 2. M2M: která představení balíček pokrývá
CREATE TABLE IF NOT EXISTS subscriptions.package_events (
  package_id        uuid NOT NULL REFERENCES subscriptions.packages(id) ON DELETE CASCADE,
  event_id          uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  order_index       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (package_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_subs_package_events_event ON subscriptions.package_events(event_id);

-- 3. Zakoupené abonentky (per subscriber, per package)
CREATE TABLE IF NOT EXISTS subscriptions.holders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id        uuid NOT NULL REFERENCES subscriptions.packages(id) ON DELETE RESTRICT,
  user_id           uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  order_id          uuid REFERENCES orders.orders(id) ON DELETE SET NULL,

  -- Identifikace držitele (i pro non-registered buyery — gift)
  holder_name       text NOT NULL,
  holder_email      text NOT NULL,
  holder_phone      text,

  -- Konkrétní místo (pokud venue má seating chart)
  preferred_seat_id uuid REFERENCES catalog.event_seats(id),
  preferred_zone    text,                          -- jen text label pokud žádné seat_id

  -- Status
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'suspended', 'cancelled', 'expired')),
  renewal_preference text NOT NULL DEFAULT 'manual'
                      CHECK (renewal_preference IN ('auto', 'manual', 'cancel')),

  -- Validity
  valid_from        timestamptz NOT NULL DEFAULT now(),
  valid_until       timestamptz NOT NULL,         -- konec sezóny

  -- Pricing snapshot (locked při koupi)
  price_paid_halire integer NOT NULL,
  currency          text NOT NULL DEFAULT 'CZK',

  created_at        timestamptz NOT NULL DEFAULT now(),
  cancelled_at      timestamptz,
  cancellation_reason text,

  CONSTRAINT uq_subs_holders_seat UNIQUE (package_id, preferred_seat_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_subs_holders_package ON subscriptions.holders(package_id, status);
CREATE INDEX IF NOT EXISTS idx_subs_holders_user ON subscriptions.holders(user_id);

-- 4. Log redemptions (kdo přišel na které představení v rámci abonentky)
CREATE TABLE IF NOT EXISTS subscriptions.redemptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_id         uuid NOT NULL REFERENCES subscriptions.holders(id) ON DELETE CASCADE,
  event_id          uuid NOT NULL REFERENCES catalog.events(id) ON DELETE RESTRICT,
  ticket_id         uuid REFERENCES tickets.tickets(id) ON DELETE SET NULL,
  redeemed_at       timestamptz NOT NULL DEFAULT now(),
  redeemed_by_user  uuid REFERENCES identity.users(id) ON DELETE SET NULL,

  CONSTRAINT uq_subs_redemptions_holder_event UNIQUE (holder_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_subs_redemptions_event ON subscriptions.redemptions(event_id);

COMMENT ON SCHEMA subscriptions IS 'Divadelní abonentky / season passes — multi-event package coverage';
COMMENT ON TABLE subscriptions.packages IS 'Definice balíčku (např. Pondělní abonentka 2026/27)';
COMMENT ON TABLE subscriptions.package_events IS 'M2M — která představení balíček pokrývá';
COMMENT ON TABLE subscriptions.holders IS 'Předplatitelé (zaplacená abonentka)';
COMMENT ON TABLE subscriptions.redemptions IS 'Log uplatnění abonentky na konkrétní představení';

COMMIT;
