-- Migration 404: Fan-to-fan secondary resale marketplace
-- Seller lists ticket → buyer purchases → atomic ticket swap

-- ─── Event resale settings ────────────────────────────────────────────────────
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS resale_enabled            boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resale_max_price_pct      numeric(5,2)  NOT NULL DEFAULT 110,   -- 110 = max 10% above face
  ADD COLUMN IF NOT EXISTS resale_platform_fee_pct   numeric(5,2)  NOT NULL DEFAULT 15,    -- Tixly takes 15% from seller
  ADD COLUMN IF NOT EXISTS resale_cooling_hours      int           NOT NULL DEFAULT 24,    -- min hours before listing
  ADD COLUMN IF NOT EXISTS resale_allow_below_face   boolean       NOT NULL DEFAULT false; -- allow listing below face value

-- ─── Link resale purchase to listing ──────────────────────────────────────────
ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS resale_listing_id uuid;

-- ─── Resale listings ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders.resale_listings (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id             uuid        NOT NULL REFERENCES orders.tickets(id)  ON DELETE CASCADE,
  seller_user_id        uuid        NOT NULL REFERENCES identity.users(id)  ON DELETE RESTRICT,
  event_id              uuid        NOT NULL REFERENCES catalog.events(id)  ON DELETE CASCADE,

  ticket_type_name      text        NOT NULL,
  seat_label            text,                   -- e.g. "Řada C, Místo 12"
  section_label         text,                   -- e.g. "Přízemí – VIP"

  original_price_halire int         NOT NULL,
  listing_price_halire  int         NOT NULL CHECK (listing_price_halire > 0),
  platform_fee_halire   int         NOT NULL,   -- Tixly fee (deducted from seller payout)
  seller_payout_halire  int         NOT NULL,   -- what seller receives

  status                text        NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available','reserved','sold','cancelled','expired')),

  listed_at             timestamptz NOT NULL DEFAULT NOW(),
  expires_at            timestamptz,
  reserved_until        timestamptz,           -- short reservation during checkout
  sold_at               timestamptz,
  cancelled_at          timestamptz,

  buyer_user_id         uuid        REFERENCES identity.users(id)  ON DELETE SET NULL,
  buyer_order_id        uuid        REFERENCES orders.orders(id)   ON DELETE SET NULL,
  new_ticket_id         uuid        REFERENCES orders.tickets(id)  ON DELETE SET NULL,

  seller_notes          text,
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resale_event_status
  ON orders.resale_listings(event_id, status);

CREATE INDEX IF NOT EXISTS idx_resale_ticket
  ON orders.resale_listings(ticket_id);

CREATE INDEX IF NOT EXISTS idx_resale_seller
  ON orders.resale_listings(seller_user_id);

-- Only one active listing per ticket at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_resale_ticket_active
  ON orders.resale_listings(ticket_id)
  WHERE status IN ('available','reserved');

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE orders.resale_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resale_bypass" ON orders.resale_listings
  FOR ALL USING (current_setting('app.bypass_rls', true) = 'on');
