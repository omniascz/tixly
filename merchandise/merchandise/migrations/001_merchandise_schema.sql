-- Migration: 001_merchandise_schema
-- Module: merchandise
-- Description: Initial schema for merchandise catalog, variants, and order items

CREATE SCHEMA IF NOT EXISTS merchandise;

-- ─── ENUMs ───────────────────────────────────────────────────────────────────

CREATE TYPE merchandise.fulfillment_type AS ENUM (
  'pickup_at_venue',   -- vyzvednutí na místě konání akce
  'shipping',          -- doručení kurýrem před akcí
  'digital'            -- digitální produkt (PDF, download)
);

CREATE TYPE merchandise.product_status AS ENUM (
  'active',
  'paused',
  'archived'
);

CREATE TYPE merchandise.order_item_status AS ENUM (
  'pending',
  'paid',
  'shipped',
  'delivered',
  'refunded',
  'cancelled'
);

-- ─── Products (catalog) ───────────────────────────────────────────────────────

CREATE TABLE merchandise.products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID,                     -- NULL = globální merch mimo event
  organizer_id    UUID NOT NULL,
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  base_price      INTEGER NOT NULL CHECK (base_price >= 0),  -- vše v halířích
  currency        CHAR(3) NOT NULL DEFAULT 'CZK',
  fulfillment     merchandise.fulfillment_type NOT NULL DEFAULT 'pickup_at_venue',
  image_urls      TEXT[] NOT NULL DEFAULT '{}',
  metadata        JSONB NOT NULL DEFAULT '{}',
  status          merchandise.product_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Product variants (size, colour…) ────────────────────────────────────────

CREATE TABLE merchandise.product_variants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES merchandise.products(id) ON DELETE CASCADE,
  sku             VARCHAR(100) NOT NULL,
  name            VARCHAR(100) NOT NULL,   -- e.g. "M / Černá", "L / Bílá"
  price_modifier  INTEGER NOT NULL DEFAULT 0,  -- haléře, added to base_price
  total_qty       INTEGER,                 -- NULL = neomezená kapacita
  sold_count      INTEGER NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  reserved_count  INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  low_threshold   INTEGER NOT NULL DEFAULT 3,
  attributes      JSONB NOT NULL DEFAULT '{}',  -- { "size": "M", "color": "black" }
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_variant_sku UNIQUE (product_id, sku),
  CONSTRAINT no_oversell CHECK (
    total_qty IS NULL OR sold_count + reserved_count <= total_qty
  )
);

-- ─── Order items (linked to main orders table) ────────────────────────────────

CREATE TABLE merchandise.order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL,           -- FK → orders.orders (external schema)
  product_id          UUID NOT NULL REFERENCES merchandise.products(id),
  variant_id          UUID NOT NULL REFERENCES merchandise.product_variants(id),
  quantity            INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price          INTEGER NOT NULL CHECK (unit_price >= 0),   -- haléře
  total_price         INTEGER NOT NULL CHECK (total_price >= 0),  -- unit_price * quantity
  fulfillment         merchandise.fulfillment_type NOT NULL,
  status              merchandise.order_item_status NOT NULL DEFAULT 'pending',
  shipping_address    JSONB,                   -- NULL for pickup / digital
  tracking_number     VARCHAR(100),
  idempotency_key     UUID NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_merch_idempotency UNIQUE (idempotency_key)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_products_event      ON merchandise.products(event_id, status);
CREATE INDEX idx_products_organizer  ON merchandise.products(organizer_id, status);
CREATE INDEX idx_variants_product    ON merchandise.product_variants(product_id, is_active);
CREATE INDEX idx_order_items_order   ON merchandise.order_items(order_id, status);

-- ─── updated_at trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION merchandise.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON merchandise.products
  FOR EACH ROW EXECUTE FUNCTION merchandise.set_updated_at();

CREATE TRIGGER trg_order_items_updated_at
  BEFORE UPDATE ON merchandise.order_items
  FOR EACH ROW EXECUTE FUNCTION merchandise.set_updated_at();

-- ─── Comments ─────────────────────────────────────────────────────────────────

COMMENT ON SCHEMA merchandise IS 'Merchandise catalog and order management for Tixly';
COMMENT ON TABLE merchandise.products IS 'Product catalog — trička, mikiny, plakáty, CD…';
COMMENT ON TABLE merchandise.product_variants IS 'Variants per product (velikost, barva)';
COMMENT ON TABLE merchandise.order_items IS 'Individual merchandise items within an order';
COMMENT ON COLUMN merchandise.products.base_price IS 'Price in haléře (CZK * 100), never float';
COMMENT ON COLUMN merchandise.product_variants.price_modifier IS 'Delta in haléře added to base_price';
COMMENT ON COLUMN merchandise.product_variants.total_qty IS 'NULL means unlimited stock';
COMMENT ON COLUMN merchandise.order_items.idempotency_key IS 'Client-provided UUID for idempotent POSTs';
