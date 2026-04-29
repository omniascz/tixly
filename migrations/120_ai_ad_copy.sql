-- Migration 120: AI ad copy generator (Feature #166)

CREATE SCHEMA IF NOT EXISTS ai_ads;

CREATE TABLE ai_ads.generated_ad_copies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL,              -- ref: catalog.events(id)
  promoter_id       UUID NOT NULL,              -- tenant
  platform          TEXT NOT NULL DEFAULT 'facebook'
                      CHECK (platform IN ('facebook', 'instagram', 'email')),
  headlines         TEXT[] NOT NULL,            -- 3–5 headlines
  body_copy         TEXT[] NOT NULL,            -- 2–3 body copy varianty
  call_to_actions   TEXT[] NOT NULL,            -- 3–5 CTA varianty
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ad_copies_event ON ai_ads.generated_ad_copies (event_id);
CREATE INDEX idx_ad_copies_promoter ON ai_ads.generated_ad_copies (promoter_id);
