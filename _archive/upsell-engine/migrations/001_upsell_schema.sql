-- Migration: 001_upsell_schema
-- Phase 2a — Upsell Engine

CREATE SCHEMA IF NOT EXISTS upsell;

CREATE TYPE upsell.upsell_type AS ENUM (
  'insurance', 'vip_upgrade', 'meet_greet', 'parking',
  'fnb_voucher', 'merchandise', 'camping_pass', 'locker',
  'travel_package', 'livestream'
);

CREATE TYPE upsell.upsell_timing AS ENUM ('checkout', 'post_purchase', 'pre_event', 'on_site');
CREATE TYPE upsell.upsell_status AS ENUM ('active', 'paused', 'archived');
CREATE TYPE upsell.upsell_order_status AS ENUM ('pending', 'paid', 'refunded', 'cancelled');

CREATE TABLE upsell.upsell_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL,
  type            upsell.upsell_type NOT NULL,
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  price           INTEGER NOT NULL CHECK (price >= 0),
  currency        CHAR(3) NOT NULL DEFAULT 'CZK',
  platform_fee_pct INTEGER NOT NULL DEFAULT 10 CHECK (platform_fee_pct BETWEEN 0 AND 100),
  image_url       TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  status          upsell.upsell_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE upsell.upsell_rules (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upsell_item_id            UUID NOT NULL REFERENCES upsell.upsell_items(id) ON DELETE CASCADE,
  ticket_type_id            UUID,
  timing                    upsell.upsell_timing NOT NULL,
  sort_order                INTEGER NOT NULL DEFAULT 100,
  max_per_order             INTEGER,
  available_from            TIMESTAMPTZ,
  available_until           TIMESTAMPTZ,
  exclusive_to_ticket_types UUID[],
  conditions                JSONB NOT NULL DEFAULT '{}',
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE upsell.upsell_inventory (
  upsell_item_id  UUID PRIMARY KEY REFERENCES upsell.upsell_items(id) ON DELETE CASCADE,
  total_qty       INTEGER,
  sold_count      INTEGER NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  reserved_count  INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  low_threshold   INTEGER NOT NULL DEFAULT 5,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_oversell CHECK (total_qty IS NULL OR sold_count + reserved_count <= total_qty)
);

CREATE TABLE upsell.upsell_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL,
  ticket_id         UUID,
  upsell_item_id    UUID NOT NULL REFERENCES upsell.upsell_items(id),
  quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price        INTEGER NOT NULL CHECK (unit_price >= 0),
  total_price       INTEGER NOT NULL CHECK (total_price >= 0),
  platform_fee_pct  INTEGER NOT NULL,
  platform_fee_amt  INTEGER NOT NULL CHECK (platform_fee_amt >= 0),
  organizer_payout  INTEGER NOT NULL CHECK (organizer_payout >= 0),
  status            upsell.upsell_order_status NOT NULL DEFAULT 'pending',
  idempotency_key   UUID NOT NULL,
  variant_metadata  JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_upsell_order_items_idempotency UNIQUE (idempotency_key)
);

CREATE TABLE upsell.upsell_analytics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upsell_item_id  UUID NOT NULL REFERENCES upsell.upsell_items(id),
  event_type      VARCHAR(50) NOT NULL,
  user_id         UUID,
  order_id        UUID,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_upsell_items_event ON upsell.upsell_items(event_id, status);
CREATE INDEX idx_upsell_rules_item ON upsell.upsell_rules(upsell_item_id, timing, is_active);
CREATE INDEX idx_upsell_order_items_order ON upsell.upsell_order_items(order_id, status);
CREATE INDEX idx_upsell_analytics_item ON upsell.upsell_analytics(upsell_item_id, event_type, created_at);

-- Trigger: auto-update updated_at on upsell_items
CREATE OR REPLACE FUNCTION upsell.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_upsell_items_updated_at
  BEFORE UPDATE ON upsell.upsell_items
  FOR EACH ROW EXECUTE FUNCTION upsell.set_updated_at();

CREATE TRIGGER trg_upsell_order_items_updated_at
  BEFORE UPDATE ON upsell.upsell_order_items
  FOR EACH ROW EXECUTE FUNCTION upsell.set_updated_at();

CREATE TRIGGER trg_upsell_inventory_updated_at
  BEFORE UPDATE ON upsell.upsell_inventory
  FOR EACH ROW EXECUTE FUNCTION upsell.set_updated_at();
