// gamification/src/lib/types.ts — Typy pro gamifikaci, badges a achievement system
// Fan dostane badge za první vstupenku, 10. akci, věrnostní milestone a další milníky.

// ---------------------------------------------------------------------------
// Badge Types
// ---------------------------------------------------------------------------

export type BadgeType =
  | 'first_ticket'      // First ticket purchased
  | 'ten_events'        // Attended 10 distinct events
  | 'hundred_tickets'   // Purchased 100+ tickets
  | 'super_fan'         // Purchased 50+ tickets (higher tier)
  | 'early_bird'        // Bought ticket 30+ days before event
  | 'friend_referrer'   // Referred 3+ friends who made a purchase
  | 'streak_attendee';  // Attended event every month for 6+ months

/**
 * Badge definition with metadata and unlock criteria.
 * Static definitions for each badge type.
 */
export interface BadgeDefinition {
  id: string;
  badgeType: BadgeType;
  name: string;
  description: string;
  icon: string; // Icon URL or icon identifier
  displayColor: string; // Hex color or CSS color name
  criteria: BadgeCriteria;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum'; // Tier for ranking
}

/**
 * Criteria for badge unlock.
 * Used to determine when a user earns a badge.
 */
export interface BadgeCriteria {
  type: 'count' | 'streak' | 'milestone' | 'time_before_event' | 'referral';
  threshold?: number;           // Count threshold (e.g., 10 events, 100 tickets, 3 referrals)
  consecutiveMonths?: number;   // For streak (e.g., 6 months)
  daysBeforeEvent?: number;     // For early_bird (e.g., 30 days)
  hint?: string;                // User-facing hint about progress
}

/**
 * Badge instance earned by a user.
 * Represents an achievement unlock for a specific user.
 */
export interface Badge {
  id: string;
  badgeType: BadgeType;
  name: string;
  description: string;
  icon: string;
  displayColor: string;
  unlockedAt?: Date;            // When badge was defined/made available
  earnedAt?: Date;              // When user earned this badge (if earned)
}

/**
 * User achievement record.
 * Audit trail and display info for earned badges.
 */
export interface Achievement {
  id: string;
  userId: string;
  badgeType: BadgeType;
  earnedAt: Date;
  displayName: string;          // For UI display: "Fanoušek" etc.
  hint?: string;                // Why they earned it
}

/**
 * Gamification statistics for a user.
 * Aggregated data for dashboard and progress tracking.
 */
export interface GameificationStats {
  userId: string;
  ticketsCount: number;         // Total tickets purchased
  eventsCount: number;          // Distinct events attended
  referralsCount: number;       // Friends referred who made purchase
  consecutiveMonths: number;    // Consecutive months with event attendance
  lastEventDate?: Date;         // Last event attended
  badges: Badge[];              // All earned badges
  badgesCount: number;          // Total earned badges
  nextBadgeEarning?: {          // Hint for next badge
    badgeType: BadgeType;
    progress: number;
    needed: number;
    percentComplete: number;
  };
}

/**
 * Badge progress tracking.
 * Used for the /upcoming endpoint to show user progress toward badges.
 */
export interface BadgeProgress {
  badgeType: BadgeType;
  name: string;
  progress: number;
  needed: number;
  percentComplete: number;
  displayColor: string;
}

// ---------------------------------------------------------------------------
// Error Classes
// ---------------------------------------------------------------------------

export class BadgeAlreadyEarnedError extends Error {
  constructor(public readonly badgeType: BadgeType) {
    super(`Badge already earned: ${badgeType}`);
    this.name = 'BadgeAlreadyEarnedError';
  }
}

export class InvalidBadgeTypeError extends Error {
  constructor(public readonly badgeType: string) {
    super(`Invalid badge type: ${badgeType}`);
    this.name = 'InvalidBadgeTypeError';
  }
}

export class GameificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameificationError';
  }
}
