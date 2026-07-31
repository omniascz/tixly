-- Marketplace Ads — CPC sponsored placements (revenue stream).
--
-- Sloty:
--   homepage_hero       (homepage, 1 placement)
--   homepage_featured   (homepage, 4 placements)
--   category_top        (top kategorie, 2 placements)
--   search_top          (search results, 3 placements, optional category filter)
--
-- Aukce: nejvyšší CPC bid wins, dynamic ordering. Click → budget_remaining -= cpc_halire.
-- Když budget_remaining < cpc_halire, kampaň auto-pauzuje.

BEGIN;

CREATE SCHEMA IF NOT EXISTS marketing;

CREATE TABLE marketing.ad_campaigns (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID         NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  event_id        UUID         NOT NULL,
  slot            TEXT         NOT NULL
    CHECK (slot IN ('homepage_hero', 'homepage_featured', 'category_top', 'search_top')),
  category        TEXT,
  status          TEXT         NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'depleted', 'finished')),
  cpc_halire      INTEGER      NOT NULL CHECK (cpc_halire >= 100), -- min 1 Kč per click
  budget_halire   INTEGER      NOT NULL CHECK (budget_halire > 0),
  budget_remaining INTEGER     NOT NULL CHECK (budget_remaining >= 0),
  impressions     INTEGER      NOT NULL DEFAULT 0,
  clicks          INTEGER      NOT NULL DEFAULT 0,
  starts_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ends_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ad_campaigns_slot_active
  ON marketing.ad_campaigns (slot, cpc_halire DESC)
  WHERE status = 'active' AND budget_remaining > 0;

CREATE INDEX idx_ad_campaigns_promoter
  ON marketing.ad_campaigns (promoter_id, created_at DESC);

CREATE TABLE marketing.ad_clicks (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID         NOT NULL REFERENCES marketing.ad_campaigns(id) ON DELETE CASCADE,
  ip            TEXT,
  user_agent    TEXT,
  user_id       UUID,
  charged_halire INTEGER     NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ad_clicks_campaign
  ON marketing.ad_clicks (campaign_id, created_at DESC);

-- Optional fraud protection: dedup clicks z same IP within 5 minutes
CREATE INDEX idx_ad_clicks_dedup
  ON marketing.ad_clicks (campaign_id, ip, created_at);

COMMENT ON TABLE marketing.ad_campaigns IS
  'CPC sponsored placements. Aukce: nejvyšší cpc_halire mezi active kampaněmi s budget_remaining >= cpc_halire vyhrává slot.';
COMMENT ON COLUMN marketing.ad_campaigns.status IS
  'active=běží, paused=ručně pauznuto, depleted=budget vyčerpaný, finished=ends_at v minulosti.';

COMMIT;
