-- =============================================================================
-- Migration 086: Branch photo gallery
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS branches;

CREATE TABLE IF NOT EXISTS branches.photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL,
  promoter_id UUID NOT NULL,
  url TEXT NOT NULL,
  alt TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('interior', 'exterior', 'equipment', 'team', 'other')),
  caption TEXT,
  uploaded_by UUID NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_branch_photos_branch
  ON branches.photos(branch_id, position);
CREATE INDEX IF NOT EXISTS idx_branch_photos_promoter
  ON branches.photos(promoter_id);
