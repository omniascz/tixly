-- Migration: 001_venue_ownership.sql
-- Adds ownership, slug, and enrichment columns to catalog.venues

ALTER TABLE catalog.venues
  ADD COLUMN IF NOT EXISTS owner_promoter_id UUID,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS slug VARCHAR(120) UNIQUE,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS geo_lat NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS geo_lng NUMERIC(9,6);

-- Index for owner queries
CREATE INDEX IF NOT EXISTS idx_venues_owner ON catalog.venues(owner_promoter_id)
  WHERE owner_promoter_id IS NOT NULL;

-- Index for public venue lookups
CREATE INDEX IF NOT EXISTS idx_venues_public ON catalog.venues(is_public)
  WHERE is_public = TRUE;

-- Index for city/country browsing
CREATE INDEX IF NOT EXISTS idx_venues_city ON catalog.venues(city, country);

-- Index for slug lookups
CREATE INDEX IF NOT EXISTS idx_venues_slug ON catalog.venues(slug)
  WHERE slug IS NOT NULL;

-- Existing venues without an owner become public (platform-owned)
UPDATE catalog.venues SET is_public = TRUE WHERE owner_promoter_id IS NULL;
