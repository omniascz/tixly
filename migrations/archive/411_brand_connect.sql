-- Migration 411: EVENTIM Brand Connect — reverse sponsorship marketplace
--
-- Architektura:
--   brands.advertisers       — externe firmy/značky (spravuje platform admin)
--   brands.campaigns         — kampaně s targetingem + kreativou + budgetem
--   brands.event_partnerships— zápasy kampaně ↔ akce (proposed/accepted/active/declined)
--   brands.impressions       — lightweight tracking (impression, click)
--
-- Flow:
--   1. Platform admin vytvoří inzerenta + kampaň
--   2. Auto-match / ruční návrh → event_partnership ve stavu 'proposed'
--   3. Promotér vidí návrhy, přijme nebo odmítne
--   4. Po přijetí se brand logo/teaser zobrazí na potvrzení objednávky
--   5. Impression/click se loguje → platba promotérovi (Tixly bere cut)

CREATE SCHEMA IF NOT EXISTS brands;

-- ─── Inzerenti ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brands.advertisers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name     text        NOT NULL,
  logo_url         text,
  website_url      text,
  industry         text,              -- 'insurance','beverage','telco','bank','auto','fmcg','sport',...
  contact_email    text        NOT NULL,
  contact_name     text,
  internal_notes   text,
  status           text        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','suspended','paused')),
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bc_advertisers_status ON brands.advertisers (status);

-- ─── Kampaně ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brands.campaigns (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id         uuid        NOT NULL REFERENCES brands.advertisers(id) ON DELETE CASCADE,
  name                  text        NOT NULL,
  -- Kreativa
  tagline               text,                     -- "Pojistěte si svůj zážitek" (max 80 znaků)
  description           text,                     -- delší text
  logo_url              text,
  banner_url            text,
  cta_text              text        DEFAULT 'Zjistit více',
  cta_url               text,
  -- Targeting
  target_event_categories text[],                 -- ['music','theater','sport',...]; NULL = vše
  target_cities           text[],                 -- ['Praha','Brno']; NULL = vše
  target_min_capacity   int,                      -- min kapacita akce
  -- Financials (platform admin vyplní)
  fee_per_event_czk     int         NOT NULL DEFAULT 0,  -- v Kč (celé), promotér dostane (1-cut)
  tixly_cut_pct         numeric(4,2) NOT NULL DEFAULT 15.00,  -- % pro Tixly
  budget_czk            int,                      -- celkový budget kampaně; NULL = unlimited
  budget_spent_czk      int         NOT NULL DEFAULT 0,
  -- Validita
  starts_at             timestamptz,
  ends_at               timestamptz,
  status                text        NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft','active','paused','ended')),
  -- Stats (denormalizované pro rychlý dashboard)
  total_partnerships    int         NOT NULL DEFAULT 0,
  total_impressions     int         NOT NULL DEFAULT 0,
  total_clicks          int         NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bc_campaigns_advertiser ON brands.campaigns (advertiser_id);
CREATE INDEX IF NOT EXISTS idx_bc_campaigns_status     ON brands.campaigns (status);

-- ─── Partnerství akce ↔ kampaň ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brands.event_partnerships (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid        NOT NULL REFERENCES brands.campaigns(id) ON DELETE CASCADE,
  event_id        uuid        NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  promoter_id     uuid        NOT NULL REFERENCES platform.promoters(id),
  status          text        NOT NULL DEFAULT 'proposed'
                              CHECK (status IN ('proposed','accepted','active','declined','expired','cancelled')),
  fee_czk         int         NOT NULL DEFAULT 0,   -- kolik dostane promotér
  tixly_fee_czk   int         NOT NULL DEFAULT 0,   -- Tixlyho podíl
  -- Placement: kde se brand zobrazí
  placement       text[]      NOT NULL DEFAULT '{"order_confirmation"}',
  -- Stats per partnership
  impressions     int         NOT NULL DEFAULT 0,
  clicks          int         NOT NULL DEFAULT 0,
  -- Timestamps
  proposed_at     timestamptz NOT NULL DEFAULT NOW(),
  responded_at    timestamptz,
  activated_at    timestamptz,
  expires_at      timestamptz,    -- automaticky expired, pokud promotér nereaguje
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_bc_ep_campaign   ON brands.event_partnerships (campaign_id);
CREATE INDEX IF NOT EXISTS idx_bc_ep_event      ON brands.event_partnerships (event_id);
CREATE INDEX IF NOT EXISTS idx_bc_ep_promoter   ON brands.event_partnerships (promoter_id);
CREATE INDEX IF NOT EXISTS idx_bc_ep_status     ON brands.event_partnerships (status);

-- ─── Impression/click log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brands.impressions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_id    uuid        NOT NULL REFERENCES brands.event_partnerships(id) ON DELETE CASCADE,
  event_id          uuid        NOT NULL,
  kind              text        NOT NULL DEFAULT 'impression'
                                CHECK (kind IN ('impression','click')),
  user_agent        text,
  created_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bc_impressions_partnership ON brands.impressions (partnership_id, created_at DESC);

COMMENT ON TABLE  brands.advertisers        IS 'Externe značky/firmy v Brand Connect';
COMMENT ON TABLE  brands.campaigns          IS 'Kampaně — targeting, kreativa, budget';
COMMENT ON TABLE  brands.event_partnerships IS 'Propojení kampaní s konkrétními akcemi';
COMMENT ON TABLE  brands.impressions        IS 'Lightweight tracking (impression/click)';
