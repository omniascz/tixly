-- Migration 118: Dynamic Creative — Automatic ad templates (Feature #59)
-- Jeden template generuje kreativy pro všechny akce automaticky.

CREATE SCHEMA IF NOT EXISTS ads;

CREATE TABLE ads.dynamic_creative_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id   UUID NOT NULL,              -- tenant
  title         TEXT NOT NULL,
  template_text TEXT NOT NULL,              -- Placeholders: {{eventTitle}}, {{eventDate}}, {{eventTime}}, {{price}}, {{venueName}}
  image_url     TEXT NOT NULL,              -- Background image
  cta_text      TEXT NOT NULL,              -- "Get Tickets"
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'active', 'archived')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_templates_promoter ON ads.dynamic_creative_templates (promoter_id);
CREATE INDEX idx_templates_active   ON ads.dynamic_creative_templates (promoter_id)
  WHERE status = 'active';
