-- =============================================================================
-- Migration 138: Fan Share — P2P Marketing with Rewards
-- Feature #25: Fans share event links and earn rewards on each sale
-- Builds on affiliate-tracking infrastructure
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS fan_share;

-- Fan share campaigns per event
CREATE TABLE fan_share.campaigns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              UUID NOT NULL REFERENCES catalog.events(id),
  promoter_id           UUID NOT NULL,
  is_active             BOOL NOT NULL DEFAULT true,
  reward_type           TEXT NOT NULL CHECK (reward_type IN ('cashback', 'vip_upgrade', 'discount_code', 'credit')),
  reward_value_hellers  INT,           -- For cashback/credit: amount in halíře
  reward_discount_pct   INT,           -- For discount: percentage (e.g., 10 = 10%)
  reward_code_prefix    TEXT,          -- For discount_code: prefix (e.g., 'FANSHARE-')
  max_referrals         INT,           -- Max referrals per fan (NULL = unlimited)
  expires_at            TIMESTAMPTZ,   -- Campaign expiry
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Individual fan share links
CREATE TABLE fan_share.share_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID NOT NULL REFERENCES fan_share.campaigns(id),
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  fan_user_id         UUID NOT NULL,  -- The fan who is sharing
  share_code          TEXT NOT NULL UNIQUE,  -- Short code for tracking URL
  referral_count      INT NOT NULL DEFAULT 0,
  conversion_count    INT NOT NULL DEFAULT 0,
  total_earned_hellers INT NOT NULL DEFAULT 0,
  is_active           BOOL NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Share conversions (when a referral results in a purchase)
CREATE TABLE fan_share.conversions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_link_id       UUID NOT NULL REFERENCES fan_share.share_links(id),
  order_id            UUID NOT NULL REFERENCES orders.orders(id),
  referred_user_id    UUID NOT NULL,   -- The buyer who used the link
  reward_issued       BOOL NOT NULL DEFAULT false,
  reward_type         TEXT,
  reward_value_hellers INT,
  reward_code         TEXT,            -- Generated discount code if applicable
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(share_link_id, order_id)      -- Idempotent on (link, order)
);

-- Indexes
CREATE INDEX idx_campaigns_event ON fan_share.campaigns(event_id);
CREATE INDEX idx_campaigns_promoter ON fan_share.campaigns(promoter_id, event_id);
CREATE INDEX idx_share_links_code ON fan_share.share_links(share_code);
CREATE INDEX idx_share_links_fan ON fan_share.share_links(fan_user_id);
CREATE INDEX idx_share_links_campaign ON fan_share.share_links(campaign_id);
CREATE INDEX idx_conversions_link ON fan_share.conversions(share_link_id);
CREATE INDEX idx_conversions_order ON fan_share.conversions(order_id);
