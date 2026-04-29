-- =============================================================================
-- Migration 160: Donation Tickets / Fundraising
-- Feature #161: Pay-what-you-want ticket type, min/max amounts, campaign goal
-- =============================================================================

CREATE TABLE IF NOT EXISTS catalog.donation_campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  promoter_id         UUID NOT NULL,
  ticket_type_id      UUID NOT NULL,           -- the donation ticket type
  name                TEXT NOT NULL,
  description         TEXT,
  goal_hellers        BIGINT,                  -- fundraising target, NULL = no goal
  min_amount_hellers  BIGINT NOT NULL DEFAULT 100,   -- minimum donation (1 CZK)
  max_amount_hellers  BIGINT,                  -- NULL = unlimited
  total_raised_hellers BIGINT NOT NULL DEFAULT 0,
  donor_count         INT NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog.donations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID NOT NULL REFERENCES catalog.donation_campaigns(id),
  order_id            UUID,
  donor_name          TEXT,                    -- optional anonymous
  donor_email         TEXT,
  amount_hellers      BIGINT NOT NULL,
  message             TEXT,                    -- optional donor message
  is_anonymous        BOOLEAN NOT NULL DEFAULT false,
  donated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add donation support to ticket_types (price optional when donation type)
ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS is_donation BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_donation_campaigns_event ON catalog.donation_campaigns(event_id);
CREATE INDEX idx_donations_campaign ON catalog.donations(campaign_id);
