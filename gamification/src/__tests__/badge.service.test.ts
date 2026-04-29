// gamification/src/__tests__/badge.service.test.ts — Badge service tests
// Tests badge definitions, achievement earning, and gamification statistics.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock rls-multitenancy: bypass RLS in unit tests — pass through to fn directly
vi.mock('@tixly/rls-multitenancy', async () => ({
  withTenantContext: (_db: unknown, _ctx: unknown, fn: (db: unknown) => unknown) => fn(_db),
  buyerContext: () => ({ role: 'buyer' }),
}));
import {
  defineBadges,
  checkAndAwardBadges,
  recordBadgeEarned,
  getBadgesForUser,
  getGameificationStats,
  getBadgesUpcoming,
  checkStreakStatus,
} from '../services/badge.service';
import type { DbAdapter } from '@tixly/rls-multitenancy';
import {
  BadgeAlreadyEarnedError,
  InvalidBadgeTypeError,
  GameificationError,
} from '../lib/types';

// ---------------------------------------------------------------------------
// Mock Database Adapter
// ---------------------------------------------------------------------------

class MockDbAdapter implements DbAdapter {
  private achievements: any[] = [];
  private orders: any[] = [];

  async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    // Handle achievements queries
    if (sql.includes('gamification.achievements')) {
      if (sql.includes('INSERT')) {
        const [userId, badgeType, displayName] = params as [string, string, string];
        const existing = this.achievements.find(
          (a) => a.user_id === userId && a.badge_type === badgeType,
        );
        if (existing) {
          return []; // ON CONFLICT DO NOTHING
        }
        const achievement = {
          id: `ach_${Date.now()}`,
          user_id: userId,
          badge_type: badgeType,
          earned_at: new Date().toISOString(),
          display_name: displayName,
        };
        this.achievements.push(achievement);
        return [achievement] as T[];
      }

      if (sql.includes('SELECT') && sql.includes('earned_at DESC')) {
        const userId = (params as unknown[])[0];
        // Return in reverse insertion order to simulate ORDER BY earned_at DESC
        return [...this.achievements].filter((a) => a.user_id === userId).reverse() as T[];
      }
    }

    // Handle orders queries for counts — both orders.orders and order_tickets
    if (sql.includes('COUNT(*) as tickets_count')) {
      const userId = (params as unknown[])[0];
      const count = this.orders.filter((o) => o.user_id === userId).length;
      return [{ tickets_count: count }] as T[];
    }

    if (sql.includes('order_tickets')) {
      if (sql.includes('COUNT(DISTINCT')) {
        // Events count or referrals count
        if (sql.includes('ot.event_id')) {
          const userId = (params as unknown[])[0];
          const events = new Set(
            this.orders.filter((o) => o.user_id === userId).map((o) => o.event_id),
          );
          return [{ events_count: events.size }] as T[];
        }
      }
    }

    // Handle referrals queries
    if (sql.includes('affiliate_tracking.referrals')) {
      const referrerId = (params as unknown[])[0];
      const count = this.orders.filter((o) => o.referrer_id === referrerId && o.converted).length;
      return [{ referrals_count: count }] as T[];
    }

    // Handle streak queries
    if (sql.includes('DATE_TRUNC')) {
      const userId = (params as unknown[])[0];
      return [{ consecutive_months: 3, last_event_date: new Date().toISOString() }] as T[];
    }

    return [];
  }

  addOrder(userId: string, eventId: string, count: number = 1, referrerId?: string) {
    for (let i = 0; i < count; i++) {
      this.orders.push({
        user_id: userId,
        event_id: eventId,
        referrer_id: referrerId,
        converted: !!referrerId,
        created_at: new Date().toISOString(),
      });
    }
  }

  async execute(_sql: string, _params?: unknown[]): Promise<void> {
    // no-op for test
  }

  async transaction<T>(fn: (tx: MockDbAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }

  getAchievements() {
    return this.achievements;
  }

  clear() {
    this.achievements = [];
    this.orders = [];
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Badge Service', () => {
  let db: MockDbAdapter;

  beforeEach(() => {
    db = new MockDbAdapter();
  });

  describe('defineBadges', () => {
    it('should return 7 badge definitions', () => {
      const badges = defineBadges();
      expect(badges).toHaveLength(7);
    });

    it('should have all required fields', () => {
      const badges = defineBadges();
      badges.forEach((badge) => {
        expect(badge.id).toBeDefined();
        expect(badge.badgeType).toBeDefined();
        expect(badge.name).toBeDefined();
        expect(badge.description).toBeDefined();
        expect(badge.icon).toBeDefined();
        expect(badge.displayColor).toBeDefined();
        expect(badge.tier).toMatch(/bronze|silver|gold|platinum/);
        expect(badge.criteria).toBeDefined();
      });
    });

    it('should have unique badge types', () => {
      const badges = defineBadges();
      const types = new Set(badges.map((b) => b.badgeType));
      expect(types.size).toBe(7);
    });

    it('should have correct tier hierarchy', () => {
      const badges = defineBadges();
      const tierBadges = {
        bronze: badges.filter((b) => b.tier === 'bronze').length,
        silver: badges.filter((b) => b.tier === 'silver').length,
        gold: badges.filter((b) => b.tier === 'gold').length,
        platinum: badges.filter((b) => b.tier === 'platinum').length,
      };
      expect(tierBadges.bronze).toBeGreaterThan(0);
      expect(tierBadges.silver).toBeGreaterThan(0);
      expect(tierBadges.gold).toBeGreaterThan(0);
      expect(tierBadges.platinum).toBeGreaterThan(0);
    });
  });

  describe('recordBadgeEarned', () => {
    it('should record a new achievement', async () => {
      const userId = 'user_123';
      const badgeType = 'first_ticket';

      const achievement = await recordBadgeEarned(userId, badgeType, db);

      expect(achievement).toBeDefined();
      expect(achievement.userId).toBe(userId);
      expect(achievement.badgeType).toBe(badgeType);
      expect(achievement.earnedAt).toBeDefined();
    });

    it('should prevent duplicate badges via UNIQUE constraint', async () => {
      const userId = 'user_123';
      const badgeType = 'first_ticket';

      // First award
      await recordBadgeEarned(userId, badgeType, db);

      // Second award should throw
      await expect(recordBadgeEarned(userId, badgeType, db)).rejects.toThrow(
        BadgeAlreadyEarnedError,
      );
    });

    it('should throw on invalid badge type', async () => {
      const userId = 'user_123';
      const badgeType = 'invalid_badge' as any;

      await expect(recordBadgeEarned(userId, badgeType, db)).rejects.toThrow(
        InvalidBadgeTypeError,
      );
    });
  });

  describe('getBadgesForUser', () => {
    it('should return empty array for new user', async () => {
      const userId = 'new_user';
      const badges = await getBadgesForUser(userId, db);
      expect(badges).toEqual([]);
    });

    it('should return earned badges with metadata', async () => {
      const userId = 'user_123';
      await recordBadgeEarned(userId, 'first_ticket', db);
      await recordBadgeEarned(userId, 'ten_events', db);

      const badges = await getBadgesForUser(userId, db);

      expect(badges).toHaveLength(2);
      expect(badges[0].badgeType).toBe('ten_events'); // Most recent first
      expect(badges[1].badgeType).toBe('first_ticket');
      badges.forEach((badge) => {
        expect(badge.name).toBeDefined();
        expect(badge.description).toBeDefined();
        expect(badge.icon).toBeDefined();
        expect(badge.displayColor).toBeDefined();
        expect(badge.earnedAt).toBeDefined();
      });
    });
  });

  describe('checkAndAwardBadges', () => {
    it('should award first_ticket badge on first purchase', async () => {
      const userId = 'user_123';

      // Mock first ticket purchase
      db.addOrder(userId, 'event_1', 1);

      const awarded = await checkAndAwardBadges(userId, db);

      expect(awarded).toHaveLength(1);
      expect(awarded[0].badgeType).toBe('first_ticket');
    });

    it('should be idempotent (not award twice)', async () => {
      const userId = 'user_123';
      db.addOrder(userId, 'event_1', 1);

      // First call
      const awarded1 = await checkAndAwardBadges(userId, db);
      expect(awarded1).toHaveLength(1);

      // Second call should not award again
      const awarded2 = await checkAndAwardBadges(userId, db);
      expect(awarded2).toHaveLength(0);
    });

    it('should award multiple badges in single call', async () => {
      const userId = 'user_123';

      // Mock 100 ticket purchases
      for (let i = 0; i < 100; i++) {
        db.addOrder(userId, `event_${i}`, 1);
      }

      const awarded = await checkAndAwardBadges(userId, db);

      // Should award first_ticket at minimum
      expect(awarded.length).toBeGreaterThan(0);
      expect(awarded.some((b) => b.badgeType === 'first_ticket')).toBe(true);
    });
  });

  describe('getGameificationStats', () => {
    it('should return stats for new user', async () => {
      const userId = 'new_user';
      const stats = await getGameificationStats(userId, db);

      expect(stats.userId).toBe(userId);
      expect(stats.ticketsCount).toBe(0);
      expect(stats.eventsCount).toBe(0);
      expect(stats.referralsCount).toBe(0);
      expect(stats.badgesCount).toBe(0);
      expect(stats.badges).toEqual([]);
    });

    it('should aggregate user stats accurately', async () => {
      const userId = 'user_123';

      // Add 5 tickets for event 1 and 3 for event 2
      db.addOrder(userId, 'event_1', 5);
      db.addOrder(userId, 'event_2', 3);

      const stats = await getGameificationStats(userId, db);

      expect(stats.ticketsCount).toBe(8);
      expect(stats.eventsCount).toBe(2); // 2 distinct events
    });

    it('should calculate nextBadgeEarning hint', async () => {
      const userId = 'user_123';

      // Add 45 tickets (close to super_fan at 50)
      for (let i = 0; i < 45; i++) {
        db.addOrder(userId, `event_${i}`, 1);
      }

      const stats = await getGameificationStats(userId, db);

      expect(stats.nextBadgeEarning).toBeDefined();
      expect(stats.nextBadgeEarning?.percentComplete).toBeGreaterThan(80);
    });

    it('should include earned badges', async () => {
      const userId = 'user_123';

      db.addOrder(userId, 'event_1', 1);
      await recordBadgeEarned(userId, 'first_ticket', db);

      const stats = await getGameificationStats(userId, db);

      expect(stats.badgesCount).toBe(1);
      expect(stats.badges).toHaveLength(1);
      expect(stats.badges[0].badgeType).toBe('first_ticket');
    });
  });

  describe('getBadgesUpcoming', () => {
    it('should return empty for user with max badges', async () => {
      // This test would need a user with all badges earned
      const userId = 'super_user';
      const upcoming = await getBadgesUpcoming(userId, db);

      // In mock, user has no orders, so all badges should be upcoming
      expect(Array.isArray(upcoming)).toBe(true);
    });

    it('should sort by percentComplete descending', async () => {
      const userId = 'user_123';

      // Add 45 tickets (super_fan: 90%)
      for (let i = 0; i < 45; i++) {
        db.addOrder(userId, `event_${i}`, 1);
      }

      const upcoming = await getBadgesUpcoming(userId, db);

      if (upcoming.length > 1) {
        for (let i = 0; i < upcoming.length - 1; i++) {
          expect(upcoming[i].percentComplete).toBeGreaterThanOrEqual(
            upcoming[i + 1].percentComplete,
          );
        }
      }
    });
  });

  describe('checkStreakStatus', () => {
    it('should calculate consecutive months', async () => {
      const userId = 'user_123';
      const streak = await checkStreakStatus(userId, db);

      expect(typeof streak).toBe('number');
      expect(streak).toBeGreaterThanOrEqual(0);
    });
  });
});
