-- =============================================================================
-- Migration 161: BOGO Promo Rules
-- Feature #162: Buy-one-get-one and conditional quantity discount rules
-- =============================================================================

CREATE TABLE IF NOT EXISTS promo.bogo_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id         UUID NOT NULL,
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  name                TEXT NOT NULL,
  description         TEXT,
  trigger_qty         INT NOT NULL CHECK (trigger_qty >= 1),   -- buy X
  free_qty            INT NOT NULL CHECK (free_qty >= 1),      -- get Y free
  max_free_tickets    INT,                                      -- cap on total free tickets
  applies_to_ticket_type_ids UUID[] NOT NULL DEFAULT '{}',     -- empty = all types
  discount_pct        DECIMAL(5,2),             -- NULL = 100% off; else partial discount
  is_active           BOOLEAN NOT NULL DEFAULT true,
  valid_from          TIMESTAMPTZ,
  valid_until         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Usage log: track how many free tickets each order received
CREATE TABLE IF NOT EXISTS promo.bogo_usages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id             UUID NOT NULL REFERENCES promo.bogo_rules(id),
  order_id            UUID NOT NULL,
  paid_qty            INT NOT NULL,
  free_qty_granted    INT NOT NULL,
  discount_hellers    BIGINT NOT NULL DEFAULT 0,
  applied_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SCHEMA IF NOT EXISTS promo;

CREATE INDEX idx_bogo_rules_event ON promo.bogo_rules(event_id);
CREATE INDEX idx_bogo_usages_order ON promo.bogo_usages(order_id);
