-- =============================================================================
-- Migration 166: Promoter Profile Page
-- Feature #184: Public branded profile with events list and follow feature
-- =============================================================================

-- Extend promoters table with public profile fields
ALTER TABLE promoters.promoters
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS facebook_url TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS twitter_url TEXT,
  ADD COLUMN IF NOT EXISTS youtube_url TEXT,
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
  ADD COLUMN IF NOT EXISTS is_profile_public BOOLEAN NOT NULL DEFAULT true;

-- Followers: buyers who follow a promoter for new event notifications
CREATE TABLE IF NOT EXISTS promoters.promoter_followers (
  promoter_id         UUID NOT NULL,
  user_id             UUID NOT NULL,
  followed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notify_new_events   BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (promoter_id, user_id)
);

CREATE INDEX idx_promoter_followers_user ON promoters.promoter_followers(user_id);
