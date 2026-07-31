-- Gamification — Achievements and Badges Schema
-- Tables: achievements, badge_definitions
-- Enables badge earning and gamification features

BEGIN;

-- ─── achievements ──────────────────────────────────────────────
CREATE TABLE gamification.achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_type text NOT NULL
    CHECK (badge_type IN ('first_ticket', 'ten_events', 'hundred_tickets', 'super_fan', 'early_bird', 'friend_referrer', 'streak_attendee')),
  earned_at timestamp with time zone NOT NULL DEFAULT NOW(),
  display_name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, badge_type)
);

-- Indexes for efficient queries
CREATE INDEX idx_achievements_user_id ON gamification.achievements(user_id);
CREATE INDEX idx_achievements_badge_type ON gamification.achievements(badge_type);
CREATE INDEX idx_achievements_earned_at ON gamification.achievements(earned_at);

-- ─── badge_definitions ────────────────────────────────────────
CREATE TABLE gamification.badge_definitions (
  id text PRIMARY KEY,
  badge_type text NOT NULL UNIQUE
    CHECK (badge_type IN ('first_ticket', 'ten_events', 'hundred_tickets', 'super_fan', 'early_bird', 'friend_referrer', 'streak_attendee')),
  name text NOT NULL,
  description text NOT NULL,
  icon_url text NOT NULL,
  display_color text NOT NULL,
  criteria_json jsonb NOT NULL,
  tier text NOT NULL
    CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
  created_at timestamp with time zone NOT NULL DEFAULT NOW()
);

-- Indexes for lookups
CREATE INDEX idx_badge_definitions_badge_type ON gamification.badge_definitions(badge_type);
CREATE INDEX idx_badge_definitions_tier ON gamification.badge_definitions(tier);

-- ─── Constraints and triggers ──────────────────────────────────

-- No explicit foreign key to badge_definitions in achievements
-- (badge_type values are validated in code)

-- Ensure at least one month separation for streak-related logic
-- (handled in application code with date_trunc)

COMMIT;
