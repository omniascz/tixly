CREATE SCHEMA IF NOT EXISTS cms;

CREATE TABLE cms.content_snippets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'plain',
  content TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'cs',
  category TEXT,
  updated_by UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (promoter_id, key, locale)
);
CREATE INDEX idx_snippets_promoter_key ON cms.content_snippets(promoter_id, key);
CREATE INDEX idx_snippets_category ON cms.content_snippets(promoter_id, category);
