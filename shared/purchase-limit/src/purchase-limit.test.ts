import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enforcePurchaseLimit,
  PurchaseLimitExceededError,
  DEFAULT_PURCHASE_LIMIT,
  type PurchaseLimitDb,
  type PurchaseLimitConfig,
} from './purchase-limit.js';

describe('Purchase Limit Enforcement', () => {
  let mockDb: PurchaseLimitDb;

  beforeEach(() => {
    mockDb = {
      countUserTicketsForEvent: vi.fn(),
      isUserVerified: vi.fn(),
    };
  });

  describe('enforcePurchaseLimit', () => {
    it('should allow verified user under limit', async () => {
      vi.mocked(mockDb.isUserVerified).mockResolvedValue(true);
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(1);

      // User has 1 ticket, requesting 2 more (total 3 < limit of 4) — should pass
      await expect(
        enforcePurchaseLimit('user-1', 'event-1', 2, mockDb),
      ).resolves.toBeUndefined();
    });

    it('should throw when verified user exceeds limit', async () => {
      vi.mocked(mockDb.isUserVerified).mockResolvedValue(true);
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(3);

      // User has 3 tickets, requesting 2 more (total 5 > limit of 4) — should throw
      await expect(
        enforcePurchaseLimit('user-1', 'event-1', 2, mockDb),
      ).rejects.toThrow(PurchaseLimitExceededError);

      const error: PurchaseLimitExceededError = new PurchaseLimitExceededError(3, 2, 4);
      expect(error.code).toBe('PURCHASE_LIMIT_EXCEEDED');
      expect(error.statusCode).toBe(409);
      expect(error.currentCount).toBe(3);
      expect(error.attemptedCount).toBe(2);
      expect(error.maxAllowed).toBe(4);
    });

    it('should allow verified user at exactly the limit', async () => {
      vi.mocked(mockDb.isUserVerified).mockResolvedValue(true);
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(2);

      // User has 2 tickets, requesting 2 more (total 4 = limit) — should pass
      await expect(
        enforcePurchaseLimit('user-1', 'event-1', 2, mockDb),
      ).resolves.toBeUndefined();
    });

    it('should skip enforcement for unverified user with verifiedOnly=true', async () => {
      vi.mocked(mockDb.isUserVerified).mockResolvedValue(false);
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(0);

      // Unverified user requesting 10 tickets — should pass (no enforcement)
      await expect(
        enforcePurchaseLimit('user-unverified', 'event-1', 10, mockDb, {
          maxTicketsPerUser: 4,
          verifiedOnly: true,
        }),
      ).resolves.toBeUndefined();

      // countUserTicketsForEvent should NOT be called
      expect(mockDb.countUserTicketsForEvent).not.toHaveBeenCalled();
    });

    it('should enforce limit for unverified user with verifiedOnly=false', async () => {
      vi.mocked(mockDb.isUserVerified).mockResolvedValue(false);
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(3);

      // Unverified user with verifiedOnly=false, has 3, requesting 2 (total 5 > limit) — throw
      await expect(
        enforcePurchaseLimit('user-unverified', 'event-1', 2, mockDb, {
          maxTicketsPerUser: 4,
          verifiedOnly: false,
        }),
      ).rejects.toThrow(PurchaseLimitExceededError);

      // countUserTicketsForEvent SHOULD be called since verifiedOnly=false
      expect(mockDb.countUserTicketsForEvent).toHaveBeenCalledWith('user-unverified', 'event-1');
    });

    it('should use default config when omitted', async () => {
      vi.mocked(mockDb.isUserVerified).mockResolvedValue(true);
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(4);

      // User has 4 (at limit), requesting 1 more — should throw with default config
      await expect(
        enforcePurchaseLimit('user-1', 'event-1', 1, mockDb),
      ).rejects.toThrow(PurchaseLimitExceededError);
    });

    it('should respect custom maxTicketsPerUser config', async () => {
      vi.mocked(mockDb.isUserVerified).mockResolvedValue(true);
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(5);

      const customConfig: PurchaseLimitConfig = {
        maxTicketsPerUser: 10,
        verifiedOnly: true,
      };

      // User has 5, requesting 3 (total 8 < limit of 10) — should pass
      await expect(
        enforcePurchaseLimit('user-1', 'event-1', 3, mockDb, customConfig),
      ).resolves.toBeUndefined();
    });
  });

  describe('PurchaseLimitExceededError', () => {
    it('should have correct error properties', () => {
      const error = new PurchaseLimitExceededError(2, 3, 4);

      expect(error.code).toBe('PURCHASE_LIMIT_EXCEEDED');
      expect(error.statusCode).toBe(409);
      expect(error.currentCount).toBe(2);
      expect(error.attemptedCount).toBe(3);
      expect(error.maxAllowed).toBe(4);
      expect(error.message).toContain('Překročen limit');
      expect(error instanceof Error).toBe(true);
    });
  });

  describe('DEFAULT_PURCHASE_LIMIT', () => {
    it('should have correct defaults', () => {
      expect(DEFAULT_PURCHASE_LIMIT.maxTicketsPerUser).toBe(4);
      expect(DEFAULT_PURCHASE_LIMIT.verifiedOnly).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should allow requesting zero tickets (no-op)', async () => {
      vi.mocked(mockDb.isUserVerified).mockResolvedValue(true);
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(4);

      // 4 existing + 0 requested = 4, not exceeding limit of 4
      await expect(
        enforcePurchaseLimit('user-1', 'event-1', 0, mockDb),
      ).resolves.toBeUndefined();
    });

    it('should throw when requesting exactly 1 over limit', async () => {
      vi.mocked(mockDb.isUserVerified).mockResolvedValue(true);
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(4);

      // 4 existing + 1 requested = 5 > limit of 4
      await expect(
        enforcePurchaseLimit('user-1', 'event-1', 1, mockDb),
      ).rejects.toThrow(PurchaseLimitExceededError);
    });

    it('should throw when user already at limit and requests 1', async () => {
      vi.mocked(mockDb.isUserVerified).mockResolvedValue(true);
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(4);

      const err = await enforcePurchaseLimit('user-1', 'event-1', 1, mockDb)
        .catch((e) => e);

      expect(err).toBeInstanceOf(PurchaseLimitExceededError);
      expect(err.currentCount).toBe(4);
      expect(err.attemptedCount).toBe(1);
      expect(err.maxAllowed).toBe(4);
    });

    it('should work with maxTicketsPerUser=1 (single ticket limit)', async () => {
      vi.mocked(mockDb.isUserVerified).mockResolvedValue(true);
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(0);

      const strictConfig: PurchaseLimitConfig = { maxTicketsPerUser: 1, verifiedOnly: true };

      // First ticket should pass
      await expect(
        enforcePurchaseLimit('user-1', 'event-1', 1, mockDb, strictConfig),
      ).resolves.toBeUndefined();

      // Second ticket should fail
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(1);
      await expect(
        enforcePurchaseLimit('user-1', 'event-1', 1, mockDb, strictConfig),
      ).rejects.toThrow(PurchaseLimitExceededError);
    });

    it('should handle large ticket quantities', async () => {
      vi.mocked(mockDb.isUserVerified).mockResolvedValue(true);
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(0);

      // Requesting 100 tickets with default limit of 4 should fail
      await expect(
        enforcePurchaseLimit('user-1', 'event-1', 100, mockDb),
      ).rejects.toThrow(PurchaseLimitExceededError);
    });

    it('should handle large maxTicketsPerUser config', async () => {
      vi.mocked(mockDb.isUserVerified).mockResolvedValue(true);
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(999);

      const largeConfig: PurchaseLimitConfig = { maxTicketsPerUser: 1000, verifiedOnly: true };

      // 999 + 1 = 1000 = limit, should pass
      await expect(
        enforcePurchaseLimit('user-1', 'event-1', 1, mockDb, largeConfig),
      ).resolves.toBeUndefined();

      // 999 + 2 = 1001 > limit, should fail
      await expect(
        enforcePurchaseLimit('user-1', 'event-1', 2, mockDb, largeConfig),
      ).rejects.toThrow(PurchaseLimitExceededError);
    });

    it('should not call isUserVerified when verifiedOnly=false', async () => {
      vi.mocked(mockDb.countUserTicketsForEvent).mockResolvedValue(0);

      await enforcePurchaseLimit('user-1', 'event-1', 1, mockDb, {
        maxTicketsPerUser: 4,
        verifiedOnly: false,
      });

      expect(mockDb.isUserVerified).not.toHaveBeenCalled();
    });

    it('should scope different events independently', async () => {
      vi.mocked(mockDb.isUserVerified).mockResolvedValue(true);

      // User has 4 for event-1 but 0 for event-2
      vi.mocked(mockDb.countUserTicketsForEvent).mockImplementation(
        async (_userId: string, eventId: string) => {
          return eventId === 'event-1' ? 4 : 0;
        },
      );

      // Should fail for event-1
      await expect(
        enforcePurchaseLimit('user-1', 'event-1', 1, mockDb),
      ).rejects.toThrow(PurchaseLimitExceededError);

      // Should pass for event-2
      await expect(
        enforcePurchaseLimit('user-1', 'event-2', 1, mockDb),
      ).resolves.toBeUndefined();
    });
  });
});
