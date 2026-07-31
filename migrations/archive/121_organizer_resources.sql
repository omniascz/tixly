-- Migration 121: Organizer Resource Hub (Feature #167)

CREATE SCHEMA IF NOT EXISTS resources;

CREATE TABLE resources.resource_hub (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type           TEXT NOT NULL CHECK (type IN ('guide', 'template', 'best_practice', 'checklist')),
  category       TEXT NOT NULL CHECK (category IN ('pricing', 'marketing', 'operations', 'technical', 'legal')),
  title          TEXT NOT NULL,
  description    TEXT,
  content_html   TEXT NOT NULL,                  -- sanitizovaný HTML
  download_url   TEXT,                           -- template file URL
  views          INTEGER NOT NULL DEFAULT 0,
  helpful_count  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resources_category ON resources.resource_hub (category);
CREATE INDEX idx_resources_type     ON resources.resource_hub (type);
CREATE INDEX idx_resources_popular  ON resources.resource_hub (views DESC, helpful_count DESC);
