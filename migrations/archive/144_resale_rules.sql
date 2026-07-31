-- =============================================================================
-- Migration 144: Artist-Controlled Resale Rules
-- Feature #38: Per-event granular resale config: allow/block, price cap, max transfers
-- =============================================================================

-- Resale rules set per event by promoter/artist
CREATE TABLE IF NOT EXISTS resale.resale_rules (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                  UUID NOT NULL UNIQUE REFERENCES catalog.events(id),
  promoter_id               UUID NOT NULL,
  resale_allowed            BOOLEAN NOT NULL DEFAULT true,
  price_cap_pct             DECIMAL(5,2),     -- % of face value (e.g. 110.00 = 110%). NULL = platform default
  max_transfers_per_ticket  INT,              -- NULL = unlimited
  require_id_match          BOOLEAN NOT NULL DEFAULT false,  -- buyer must match original buyer ID
  block_reason              TEXT,             -- visible to seller if resale_allowed=false
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-ticket-type overrides (optional, more granular)
CREATE TABLE IF NOT EXISTS resale.resale_rules_overrides (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resale_rule_id            UUID NOT NULL REFERENCES resale.resale_rules(id) ON DELETE CASCADE,
  ticket_type_id            UUID NOT NULL,
  resale_allowed            BOOLEAN,          -- NULL = inherit from event rule
  price_cap_pct             DECIMAL(5,2),     -- NULL = inherit from event rule
  max_transfers_per_ticket  INT,              -- NULL = inherit from event rule
  UNIQUE (resale_rule_id, ticket_type_id)
);

CREATE INDEX idx_resale_rules_event ON resale.resale_rules(event_id);
CREATE INDEX idx_resale_rules_promoter ON resale.resale_rules(promoter_id);
