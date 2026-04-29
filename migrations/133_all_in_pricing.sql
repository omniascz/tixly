-- =============================================================================
-- Migration 133: All-In Pricing — Price Breakdown Display (EU Regulation)
-- Feature #35: Show total price (face value + fees + VAT) at first display
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS pricing;

-- Price tier configuration per event
CREATE TABLE pricing.price_tiers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES catalog.events(id),
  ticket_type_id    UUID REFERENCES catalogs.ticket_types(id),
  face_value_hellers INT NOT NULL,        -- Base ticket price (in halíře)
  platform_fee_hellers INT NOT NULL,      -- Tixly platform fee
  vat_rate          DECIMAL(5,2) NOT NULL DEFAULT 21.00,  -- VAT rate in %
  vat_hellers       INT NOT NULL,         -- Calculated VAT amount
  total_hellers     INT NOT NULL,         -- Final total (face_value + platform_fee + VAT)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, ticket_type_id)
);

-- Price display preferences per organizer
CREATE TABLE pricing.organizer_pricing_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id       UUID NOT NULL UNIQUE,
  show_breakdown    BOOL NOT NULL DEFAULT true,
  show_platform_fee BOOL NOT NULL DEFAULT true,
  show_vat          BOOL NOT NULL DEFAULT true,
  hide_vat_value    BOOL NOT NULL DEFAULT false,  -- Show "incl. VAT" but not amount
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Historical pricing log for audit trail
CREATE TABLE pricing.price_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_tier_id     UUID NOT NULL REFERENCES pricing.price_tiers(id),
  previous_total    INT,
  new_total         INT NOT NULL,
  changed_by        UUID,  -- user ID who made the change
  change_reason     TEXT,
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_price_tiers_event ON pricing.price_tiers(event_id);
CREATE INDEX idx_price_tiers_ticket_type ON pricing.price_tiers(ticket_type_id);
CREATE INDEX idx_price_history_tier ON pricing.price_history(price_tier_id);
CREATE INDEX idx_price_history_changed_at ON pricing.price_history(changed_at);
