CREATE SCHEMA IF NOT EXISTS cms;

CREATE TABLE cms.landing_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  meta_title TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  meta_keywords TEXT,
  og_title TEXT,
  og_description TEXT,
  og_image TEXT,
  canonical_url TEXT,
  hreflang JSONB,
  status TEXT NOT NULL DEFAULT 'draft',
  static_html_path TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (promoter_id, slug)
);
CREATE INDEX idx_landing_pages_promoter_status ON cms.landing_pages(promoter_id, status);

CREATE TABLE cms.content_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES cms.landing_pages(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  position INTEGER NOT NULL,
  data JSONB NOT NULL,
  variant TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_content_blocks_page_pos ON cms.content_blocks(page_id, position);
