/**
 * Tests for tenant helper factory funkce
 *
 * Ověřuje:
 * - serviceContext() → { role: 'service' }
 * - adminContext(userId) → { role: 'admin', userId }
 * - promoterContext(promoterId, userId) → { role: 'promoter', promoterId, userId }
 * - buyerContext(userId) → { role: 'buyer', userId }
 * - Výsledky jsou plain objects (bez vedlejších efektů)
 */

import { describe, it, expect } from 'vitest';
import {
  serviceContext,
  adminContext,
  promoterContext,
  buyerContext,
} from '../lib/tenant-helpers';

// ─── Test UUIDs ────────────────────────────────────────────────────────────

const USER_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const PROMOTER_UUID = '550e8400-e29b-41d4-a716-446655440000';

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('tenant helpers', () => {
  describe('serviceContext()', () => {
    it('vrátí { role: "service" }', () => {
      const ctx = serviceContext();

      expect(ctx).toEqual({ role: 'service' });
    });

    it('vrátí objekt bez promoterId a userId', () => {
      const ctx = serviceContext();

      expect(ctx.promoterId).toBeUndefined();
      expect((ctx as { userId?: string }).userId).toBeUndefined();
    });
  });

  describe('adminContext()', () => {
    it('vrátí { role: "admin", userId }', () => {
      const ctx = adminContext(USER_UUID);

      expect(ctx).toEqual({ role: 'admin', userId: USER_UUID });
    });

    it('userId je přesně předaný argument', () => {
      const ctx = adminContext(USER_UUID);

      expect(ctx.userId).toBe(USER_UUID);
    });

    it('role je "admin"', () => {
      const ctx = adminContext(USER_UUID);

      expect(ctx.role).toBe('admin');
    });
  });

  describe('promoterContext()', () => {
    it('vrátí správný objekt se všemi hodnotami', () => {
      const ctx = promoterContext(PROMOTER_UUID, USER_UUID);

      expect(ctx).toEqual({
        role: 'promoter',
        promoterId: PROMOTER_UUID,
        userId: USER_UUID,
      });
    });

    it('role je "promoter"', () => {
      const ctx = promoterContext(PROMOTER_UUID, USER_UUID);

      expect(ctx.role).toBe('promoter');
    });

    it('promoterId odpovídá prvnímu argumentu', () => {
      const ctx = promoterContext(PROMOTER_UUID, USER_UUID);

      expect(ctx.promoterId).toBe(PROMOTER_UUID);
    });

    it('userId odpovídá druhému argumentu', () => {
      const ctx = promoterContext(PROMOTER_UUID, USER_UUID);

      expect(ctx.userId).toBe(USER_UUID);
    });
  });

  describe('buyerContext()', () => {
    it('vrátí { role: "buyer", userId }', () => {
      const ctx = buyerContext(USER_UUID);

      expect(ctx).toEqual({ role: 'buyer', userId: USER_UUID });
    });

    it('role je "buyer"', () => {
      const ctx = buyerContext(USER_UUID);

      expect(ctx.role).toBe('buyer');
    });

    it('promoterId je undefined', () => {
      const ctx = buyerContext(USER_UUID);

      expect(ctx.promoterId).toBeUndefined();
    });
  });

  describe('immutability — výsledky jsou plain objects', () => {
    it('serviceContext vrátí nový objekt při každém volání', () => {
      const ctx1 = serviceContext();
      const ctx2 = serviceContext();

      expect(ctx1).not.toBe(ctx2);
      expect(ctx1).toEqual(ctx2);
    });

    it('promoterContext vrátí nový objekt při každém volání', () => {
      const ctx1 = promoterContext(PROMOTER_UUID, USER_UUID);
      const ctx2 = promoterContext(PROMOTER_UUID, USER_UUID);

      expect(ctx1).not.toBe(ctx2);
      expect(ctx1).toEqual(ctx2);
    });

    it('mutace výsledku neovlivní další volání', () => {
      const ctx1 = promoterContext(PROMOTER_UUID, USER_UUID);
      // Mutace — TypeScript by to zabranil, ale v runtime to je možné
      (ctx1 as { role: string }).role = 'admin';

      const ctx2 = promoterContext(PROMOTER_UUID, USER_UUID);
      expect(ctx2.role).toBe('promoter');
    });
  });
});
