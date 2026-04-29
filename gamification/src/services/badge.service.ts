// gamification/src/services/badge.service.ts — Badge earning and gamification logic
// Manages badge definitions, unlocks, and user achievement tracking.

import type {
  Badge,
  Achievement,
  GameificationStats,
  BadgeType,
  BadgeDefinition,
  BadgeProgress,
} from '../lib/types';
import {
  BadgeAlreadyEarnedError,
  InvalidBadgeTypeError,
  GameificationError,
} from '../lib/types';
import { withTenantContext, buyerContext } from '@tixly/rls-multitenancy';
import type { DbAdapter } from '@tixly/rls-multitenancy';

// ---------------------------------------------------------------------------
// Service Dependencies
// ---------------------------------------------------------------------------

export interface BadgeServiceDeps {
  db: DbAdapter;
}

// ---------------------------------------------------------------------------
// Internal row types (DB results)
// ---------------------------------------------------------------------------

interface AchievementRow {
  id: string;
  user_id: string;
  badge_type: string;
  earned_at: string;
  display_name: string;
}

interface BadgeDefinitionRow {
  id: string;
  badge_type: string;
  name: string;
  description: string;
  icon_url: string;
  display_color: string;
  criteria_json: string;
  tier: string;
}

interface UserTicketsRow {
  tickets_count: number;
}

interface UserEventsRow {
  events_count: number;
}

interface UserReferralsRow {
  referrals_count: number;
}

interface UserStreakRow {
  consecutive_months: number;
  last_event_date: string | null;
}

// ---------------------------------------------------------------------------
// Badge Definitions
// ---------------------------------------------------------------------------

/**
 * Static badge definitions for all badge types.
 * Each badge has unlock criteria, description, and tier.
 */
export function defineBadges(): BadgeDefinition[] {
  return [
    {
      id: 'badge_first_ticket',
      badgeType: 'first_ticket',
      name: 'První vstupenka',
      description: 'Koupil jsi si svou první vstupenku na Tixly!',
      icon: 'ticket-primary',
      displayColor: '#4F46E5',
      tier: 'bronze',
      criteria: {
        type: 'count',
        threshold: 1,
        hint: 'Kup si první vstupenku',
      },
    },
    {
      id: 'badge_ten_events',
      badgeType: 'ten_events',
      name: 'Desátkrát',
      description: 'Zúčastnil jsi se 10 různých akcí. Milovník kultury!',
      icon: 'star',
      displayColor: '#F59E0B',
      tier: 'silver',
      criteria: {
        type: 'count',
        threshold: 10,
        hint: 'Zúčastni se 10 akcí',
      },
    },
    {
      id: 'badge_hundred_tickets',
      badgeType: 'hundred_tickets',
      name: 'Stovka',
      description: 'Koupil jsi 100+ vstupenek. Nevídaný sbírač!',
      icon: 'medal',
      displayColor: '#EC4899',
      tier: 'gold',
      criteria: {
        type: 'count',
        threshold: 100,
        hint: 'Nakup 100 vstupenek',
      },
    },
    {
      id: 'badge_super_fan',
      badgeType: 'super_fan',
      name: 'Super fanoušek',
      description: 'Koupil jsi 50+ vstupenek. Nejlepší fanoušek!',
      icon: 'flame',
      displayColor: '#EF4444',
      tier: 'platinum',
      criteria: {
        type: 'count',
        threshold: 50,
        hint: 'Nakup 50 vstupenek',
      },
    },
    {
      id: 'badge_early_bird',
      badgeType: 'early_bird',
      name: 'Včasný pták',
      description: 'Koupil jsi si vstupenku 30+ dní předem. Plánuješ si!',
      icon: 'sun',
      displayColor: '#F97316',
      tier: 'silver',
      criteria: {
        type: 'time_before_event',
        daysBeforeEvent: 30,
        hint: 'Kup vstupenku 30 dní předem',
      },
    },
    {
      id: 'badge_friend_referrer',
      badgeType: 'friend_referrer',
      name: 'Kamarádem',
      description: 'Přizval jsi 3+ kamarády, kteří si koupili vstupenku.',
      icon: 'users',
      displayColor: '#06B6D4',
      tier: 'gold',
      criteria: {
        type: 'referral',
        threshold: 3,
        hint: 'Přizvi 3 kamarády',
      },
    },
    {
      id: 'badge_streak_attendee',
      badgeType: 'streak_attendee',
      name: 'Věrný návštěvník',
      description: 'Byl jsi na akci každý měsíc po dobu 6+ měsíců!',
      icon: 'calendar',
      displayColor: '#10B981',
      tier: 'platinum',
      criteria: {
        type: 'streak',
        consecutiveMonths: 6,
        hint: 'Měj 6 měsíců v řadě',
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// mappers
// ---------------------------------------------------------------------------

function mapAchievement(row: AchievementRow): Achievement {
  return {
    id: row.id,
    userId: row.user_id,
    badgeType: row.badge_type as BadgeType,
    earnedAt: new Date(row.earned_at),
    displayName: row.display_name,
  };
}

function mapBadgeDefinition(row: BadgeDefinitionRow): BadgeDefinition {
  return {
    id: row.id,
    badgeType: row.badge_type as BadgeType,
    name: row.name,
    description: row.description,
    icon: row.icon_url,
    displayColor: row.display_color,
    tier: row.tier as 'bronze' | 'silver' | 'gold' | 'platinum',
    criteria: JSON.parse(row.criteria_json),
  };
}

// ---------------------------------------------------------------------------
// checkAndAwardBadges
// ---------------------------------------------------------------------------

/**
 * Check all badges and award new ones to user if criteria met.
 * Idempotent: uses UNIQUE(user_id, badge_type) to prevent duplicates.
 * Calls each badge check individually for clarity, but in one transaction.
 */
export async function checkAndAwardBadges(
  userId: string,
  db: DbAdapter,
): Promise<Badge[]> {
  return withTenantContext(db, buyerContext(userId), async (tx) => {
    const badges = defineBadges();
    const awarded: Badge[] = [];

    for (const badge of badges) {
      try {
        const shouldEarn = await checkBadgeCriteria(userId, badge.badgeType, tx);
        if (shouldEarn) {
          await recordBadgeEarned(userId, badge.badgeType, tx);
          awarded.push({
            id: badge.id,
            badgeType: badge.badgeType,
            name: badge.name,
            description: badge.description,
            icon: badge.icon,
            displayColor: badge.displayColor,
            earnedAt: new Date(),
          });
        }
      } catch (error) {
        if (error instanceof BadgeAlreadyEarnedError) {
          // Already has badge, continue to next
          continue;
        }
        throw error;
      }
    }

    return awarded;
  });
}

// ---------------------------------------------------------------------------
// Badge Criteria Checkers
// ---------------------------------------------------------------------------

/**
 * Determine if user meets criteria for a specific badge.
 * Returns true if user should earn the badge, false otherwise.
 */
async function checkBadgeCriteria(
  userId: string,
  badgeType: BadgeType,
  db: DbAdapter,
): Promise<boolean> {
  switch (badgeType) {
    case 'first_ticket':
      return checkFirstTicket(userId, db);
    case 'ten_events':
      return checkTenEvents(userId, db);
    case 'hundred_tickets':
      return checkHundredTickets(userId, db);
    case 'super_fan':
      return checkSuperFan(userId, db);
    case 'early_bird':
      return checkEarlyBird(userId, db);
    case 'friend_referrer':
      return checkFriendReferrer(userId, db);
    case 'streak_attendee':
      return checkStreakAttendee(userId, db);
    default:
      throw new InvalidBadgeTypeError(badgeType);
  }
}

async function checkFirstTicket(userId: string, db: DbAdapter): Promise<boolean> {
  const result = await db.query<UserTicketsRow>(
    `SELECT COUNT(*) as tickets_count FROM orders.orders
     WHERE user_id = $1 AND status = 'completed'`,
    [userId],
  );
  return result[0]?.tickets_count >= 1 ?? false;
}

async function checkTenEvents(userId: string, db: DbAdapter): Promise<boolean> {
  const result = await db.query<UserEventsRow>(
    `SELECT COUNT(DISTINCT ot.event_id) as events_count
     FROM orders.orders o
     JOIN orders.order_tickets ot ON o.id = ot.order_id
     WHERE o.user_id = $1 AND o.status = 'completed'`,
    [userId],
  );
  return result[0]?.events_count >= 10 ?? false;
}

async function checkHundredTickets(userId: string, db: DbAdapter): Promise<boolean> {
  const result = await db.query<UserTicketsRow>(
    `SELECT COUNT(*) as tickets_count FROM orders.order_tickets ot
     JOIN orders.orders o ON ot.order_id = o.id
     WHERE o.user_id = $1 AND o.status = 'completed'`,
    [userId],
  );
  return result[0]?.tickets_count >= 100 ?? false;
}

async function checkSuperFan(userId: string, db: DbAdapter): Promise<boolean> {
  const result = await db.query<UserTicketsRow>(
    `SELECT COUNT(*) as tickets_count FROM orders.order_tickets ot
     JOIN orders.orders o ON ot.order_id = o.id
     WHERE o.user_id = $1 AND o.status = 'completed'`,
    [userId],
  );
  return result[0]?.tickets_count >= 50 ?? false;
}

async function checkEarlyBird(userId: string, db: DbAdapter): Promise<boolean> {
  // User earned this badge if they bought a ticket 30+ days before event starts
  const result = await db.query<{ found: boolean }>(
    `SELECT true as found FROM orders.orders o
     JOIN orders.order_tickets ot ON o.id = ot.order_id
     JOIN events.events e ON ot.event_id = e.id
     WHERE o.user_id = $1 AND o.status = 'completed'
     AND o.created_at <= (e.date_start - interval '30 days')
     LIMIT 1`,
    [userId],
  );
  return result.length > 0;
}

async function checkFriendReferrer(userId: string, db: DbAdapter): Promise<boolean> {
  const result = await db.query<UserReferralsRow>(
    `SELECT COUNT(DISTINCT referred_user_id) as referrals_count
     FROM affiliate_tracking.referrals
     WHERE referrer_id = $1 AND converted = true`,
    [userId],
  );
  return result[0]?.referrals_count >= 3 ?? false;
}

async function checkStreakAttendee(userId: string, db: DbAdapter): Promise<boolean> {
  const streak = await calculateConsecutiveMonthsAttended(userId, db);
  return streak >= 6;
}

// ---------------------------------------------------------------------------
// recordBadgeEarned
// ---------------------------------------------------------------------------

/**
 * Record that user earned a badge.
 * Idempotent via UNIQUE(user_id, badge_type) constraint.
 * Throws BadgeAlreadyEarnedError if already earned.
 */
export async function recordBadgeEarned(
  userId: string,
  badgeType: BadgeType,
  db: DbAdapter,
): Promise<Achievement> {
  const badge = defineBadges().find((b) => b.badgeType === badgeType);
  if (!badge) {
    throw new InvalidBadgeTypeError(badgeType);
  }

  try {
    const result = await db.query<AchievementRow>(
      `INSERT INTO gamification.achievements (user_id, badge_type, earned_at, display_name)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (user_id, badge_type) DO NOTHING
       RETURNING id, user_id, badge_type, earned_at, display_name`,
      [userId, badgeType, badge.name],
    );

    if (result.length === 0) {
      throw new BadgeAlreadyEarnedError(badgeType);
    }

    return mapAchievement(result[0]);
  } catch (error) {
    if (error instanceof BadgeAlreadyEarnedError) {
      throw error;
    }
    throw new GameificationError(`Failed to record badge: ${String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// getBadgesForUser
// ---------------------------------------------------------------------------

/**
 * Get all badges earned by user with metadata.
 * Only returns earned badges (privacy: don't show locked badges).
 */
export async function getBadgesForUser(
  userId: string,
  db: DbAdapter,
): Promise<Badge[]> {
  return withTenantContext(db, buyerContext(userId), async (tx) => {
    const achievements = await tx.query<AchievementRow>(
      `SELECT a.id, a.user_id, a.badge_type, a.earned_at, a.display_name
       FROM gamification.achievements a
       WHERE a.user_id = $1
       ORDER BY a.earned_at DESC`,
      [userId],
    );

    const badges = defineBadges();
    return achievements.map((ach) => {
      const badge = badges.find((b) => b.badgeType === ach.badge_type);
      return {
        id: badge?.id || `badge_${ach.badge_type}`,
        badgeType: ach.badge_type as BadgeType,
        name: ach.display_name,
        description: badge?.description || '',
        icon: badge?.icon || 'star',
        displayColor: badge?.displayColor || '#4F46E5',
        earnedAt: new Date(ach.earned_at),
      };
    });
  });
}

// ---------------------------------------------------------------------------
// getGameificationStats
// ---------------------------------------------------------------------------

/**
 * Get full gamification stats for user.
 * Includes tickets, events, badges, streak info, and next badge hint.
 */
export async function getGameificationStats(
  userId: string,
  db: DbAdapter,
): Promise<GameificationStats> {
  return withTenantContext(db, buyerContext(userId), async (tx) => {
    // Get counts
    const ticketsResult = await tx.query<UserTicketsRow>(
      `SELECT COUNT(*) as tickets_count FROM orders.order_tickets ot
       JOIN orders.orders o ON ot.order_id = o.id
       WHERE o.user_id = $1 AND o.status = 'completed'`,
      [userId],
    );
    const ticketsCount = ticketsResult[0]?.tickets_count ?? 0;

    const eventsResult = await tx.query<UserEventsRow>(
      `SELECT COUNT(DISTINCT ot.event_id) as events_count
       FROM orders.orders o
       JOIN orders.order_tickets ot ON o.id = ot.order_id
       WHERE o.user_id = $1 AND o.status = 'completed'`,
      [userId],
    );
    const eventsCount = eventsResult[0]?.events_count ?? 0;

    const referralsResult = await tx.query<UserReferralsRow>(
      `SELECT COUNT(DISTINCT referred_user_id) as referrals_count
       FROM affiliate_tracking.referrals
       WHERE referrer_id = $1 AND converted = true`,
      [userId],
    );
    const referralsCount = referralsResult[0]?.referrals_count ?? 0;

    // Get streak and last event date
    const streakResult = await tx.query<UserStreakRow>(
      `SELECT
         (SELECT COUNT(DISTINCT DATE_TRUNC('month', e.date_start))
          FROM orders.orders o
          JOIN orders.order_tickets ot ON o.id = ot.order_id
          JOIN events.events e ON ot.event_id = e.id
          WHERE o.user_id = $1 AND o.status = 'completed'
          AND DATE_TRUNC('month', e.date_start) >= NOW() - interval '1 year') as consecutive_months,
         (SELECT MAX(e.date_start) FROM orders.orders o
          JOIN orders.order_tickets ot ON o.id = ot.order_id
          JOIN events.events e ON ot.event_id = e.id
          WHERE o.user_id = $1 AND o.status = 'completed') as last_event_date`,
      [userId],
    );

    const consecutiveMonths = streakResult[0]?.consecutive_months ?? 0;
    const lastEventDate = streakResult[0]?.last_event_date
      ? new Date(streakResult[0].last_event_date)
      : undefined;

    // Get earned badges
    const badges = await getBadgesForUser(userId, tx);

    // Calculate next badge earning
    const nextBadge = calculateNextBadgeHint(ticketsCount, eventsCount, referralsCount, consecutiveMonths);

    return {
      userId,
      ticketsCount,
      eventsCount,
      referralsCount,
      consecutiveMonths,
      lastEventDate,
      badges,
      badgesCount: badges.length,
      nextBadgeEarning: nextBadge || undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// calculateNextBadgeHint
// ---------------------------------------------------------------------------

function calculateNextBadgeHint(
  ticketsCount: number,
  eventsCount: number,
  referralsCount: number,
  consecutiveMonths: number,
): BadgeProgress | null {
  // Determine which badge is closest to being earned
  const candidates: BadgeProgress[] = [];

  if (ticketsCount < 100) {
    candidates.push({
      badgeType: 'hundred_tickets',
      name: 'Stovka',
      progress: ticketsCount,
      needed: 100,
      percentComplete: Math.round((ticketsCount / 100) * 100),
      displayColor: '#EC4899',
    });
  }

  if (eventsCount < 10) {
    candidates.push({
      badgeType: 'ten_events',
      name: 'Desátkrát',
      progress: eventsCount,
      needed: 10,
      percentComplete: Math.round((eventsCount / 10) * 100),
      displayColor: '#F59E0B',
    });
  }

  if (ticketsCount < 50) {
    candidates.push({
      badgeType: 'super_fan',
      name: 'Super fanoušek',
      progress: ticketsCount,
      needed: 50,
      percentComplete: Math.round((ticketsCount / 50) * 100),
      displayColor: '#EF4444',
    });
  }

  if (referralsCount < 3) {
    candidates.push({
      badgeType: 'friend_referrer',
      name: 'Kamarádem',
      progress: referralsCount,
      needed: 3,
      percentComplete: Math.round((referralsCount / 3) * 100),
      displayColor: '#06B6D4',
    });
  }

  if (consecutiveMonths < 6) {
    candidates.push({
      badgeType: 'streak_attendee',
      name: 'Věrný návštěvník',
      progress: consecutiveMonths,
      needed: 6,
      percentComplete: Math.round((consecutiveMonths / 6) * 100),
      displayColor: '#10B981',
    });
  }

  // Return the closest badge to unlocking
  return candidates.length > 0
    ? candidates.sort((a, b) => b.percentComplete - a.percentComplete)[0]
    : null;
}

// ---------------------------------------------------------------------------
// getBadgesUpcoming
// ---------------------------------------------------------------------------

/**
 * Get badges user is close to earning.
 * Returns badges with progress percentage.
 */
export async function getBadgesUpcoming(
  userId: string,
  db: DbAdapter,
): Promise<BadgeProgress[]> {
  return withTenantContext(db, buyerContext(userId), async (tx) => {
    const stats = await getGameificationStats(userId, tx);

    const upcoming: BadgeProgress[] = [];

    if (stats.ticketsCount < 100) {
      upcoming.push({
        badgeType: 'hundred_tickets',
        name: 'Stovka',
        progress: stats.ticketsCount,
        needed: 100,
        percentComplete: Math.round((stats.ticketsCount / 100) * 100),
        displayColor: '#EC4899',
      });
    }

    if (stats.eventsCount < 10) {
      upcoming.push({
        badgeType: 'ten_events',
        name: 'Desátkrát',
        progress: stats.eventsCount,
        needed: 10,
        percentComplete: Math.round((stats.eventsCount / 10) * 100),
        displayColor: '#F59E0B',
      });
    }

    if (stats.ticketsCount < 50) {
      upcoming.push({
        badgeType: 'super_fan',
        name: 'Super fanoušek',
        progress: stats.ticketsCount,
        needed: 50,
        percentComplete: Math.round((stats.ticketsCount / 50) * 100),
        displayColor: '#EF4444',
      });
    }

    if (stats.referralsCount < 3) {
      upcoming.push({
        badgeType: 'friend_referrer',
        name: 'Kamarádem',
        progress: stats.referralsCount,
        needed: 3,
        percentComplete: Math.round((stats.referralsCount / 3) * 100),
        displayColor: '#06B6D4',
      });
    }

    if (stats.consecutiveMonths < 6) {
      upcoming.push({
        badgeType: 'streak_attendee',
        name: 'Věrný návštěvník',
        progress: stats.consecutiveMonths,
        needed: 6,
        percentComplete: Math.round((stats.consecutiveMonths / 6) * 100),
        displayColor: '#10B981',
      });
    }

    return upcoming.sort((a, b) => b.percentComplete - a.percentComplete);
  });
}

// ---------------------------------------------------------------------------
// checkStreakStatus
// ---------------------------------------------------------------------------

/**
 * Calculate consecutive months attended.
 * Returns number of months in a row user attended an event.
 */
export async function checkStreakStatus(
  userId: string,
  db: DbAdapter,
): Promise<number> {
  return withTenantContext(db, buyerContext(userId), async (tx) => {
    return calculateConsecutiveMonthsAttended(userId, tx);
  });
}

async function calculateConsecutiveMonthsAttended(
  userId: string,
  db: DbAdapter,
): Promise<number> {
  const result = await db.query<{ months: string[] }>(
    `SELECT array_agg(DISTINCT DATE_TRUNC('month', e.date_start)::date ORDER BY DATE_TRUNC('month', e.date_start)::date DESC)::text[] as months
     FROM orders.orders o
     JOIN orders.order_tickets ot ON o.id = ot.order_id
     JOIN events.events e ON ot.event_id = e.id
     WHERE o.user_id = $1 AND o.status = 'completed'`,
    [userId],
  );

  if (!result[0]?.months || result[0].months.length === 0) {
    return 0;
  }

  // Count consecutive months from most recent
  let streak = 1;
  const months = result[0].months.map((m) => new Date(m));

  for (let i = 0; i < months.length - 1; i++) {
    const current = new Date(months[i]);
    const next = new Date(months[i + 1]);

    // Check if months are exactly 1 month apart
    const diff = (current.getFullYear() - next.getFullYear()) * 12 + (current.getMonth() - next.getMonth());
    if (diff === 1) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}
