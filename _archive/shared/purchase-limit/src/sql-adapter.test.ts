import { describe, it, expect, vi } from 'vitest';
import { createSqlPurchaseLimitDb } from './sql-adapter.js';

describe('createSqlPurchaseLimitDb', () => {
  describe('countUserTicketsForEvent', () => {
    it('returns ticket count from order_items', async () => {
      const db = { query: vi.fn().mockResolvedValue([{ total: '7' }]) };
      const adapter = createSqlPurchaseLimitDb(db);
      const count = await adapter.countUserTicketsForEvent('user_1', 'evt_1');
      expect(count).toBe(7);
      const sql = db.query.mock.calls[0][0] as string;
      expect(sql).toContain('orders.order_items');
      expect(sql).toContain("('paid', 'pending')");
    });

    it('returns 0 when no orders exist', async () => {
      const db = { query: vi.fn().mockResolvedValue([{ total: '0' }]) };
      const adapter = createSqlPurchaseLimitDb(db);
      expect(await adapter.countUserTicketsForEvent('user_1', 'evt_1')).toBe(0);
    });

    it('returns 0 when query returns empty', async () => {
      const db = { query: vi.fn().mockResolvedValue([]) };
      const adapter = createSqlPurchaseLimitDb(db);
      expect(await adapter.countUserTicketsForEvent('user_1', 'evt_1')).toBe(0);
    });
  });

  describe('isUserVerified', () => {
    it('returns true for verified user', async () => {
      const db = { query: vi.fn().mockResolvedValue([{ email_verified: true }]) };
      const adapter = createSqlPurchaseLimitDb(db);
      expect(await adapter.isUserVerified('user_1')).toBe(true);
    });

    it('returns false for unverified user', async () => {
      const db = { query: vi.fn().mockResolvedValue([{ email_verified: false }]) };
      const adapter = createSqlPurchaseLimitDb(db);
      expect(await adapter.isUserVerified('user_1')).toBe(false);
    });

    it('returns false when user not found', async () => {
      const db = { query: vi.fn().mockResolvedValue([]) };
      const adapter = createSqlPurchaseLimitDb(db);
      expect(await adapter.isUserVerified('nonexistent')).toBe(false);
    });
  });
});
