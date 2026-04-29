import { describe, it, expect } from 'vitest';
import { getDaysSinceLastPurchase, getDormancyLevel } from './dormancy.js';

describe('dormancy', () => {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  describe('getDaysSinceLastPurchase', () => {
    it('should return 0 for purchase today', () => {
      const now = new Date();
      const days = getDaysSinceLastPurchase(now, now);
      expect(days).toBe(0);
    });

    it('should return 1 for purchase yesterday', () => {
      const now = new Date();
      const lastPurchase = new Date(now.getTime() - MS_PER_DAY);
      const days = getDaysSinceLastPurchase(lastPurchase, now);
      expect(days).toBe(1);
    });

    it('should return 30 for purchase 30 days ago', () => {
      const now = new Date();
      const lastPurchase = new Date(now.getTime() - 30 * MS_PER_DAY);
      const days = getDaysSinceLastPurchase(lastPurchase, now);
      expect(days).toBe(30);
    });

    it('should return 90 for purchase 90 days ago', () => {
      const now = new Date();
      const lastPurchase = new Date(now.getTime() - 90 * MS_PER_DAY);
      const days = getDaysSinceLastPurchase(lastPurchase, now);
      expect(days).toBe(90);
    });

    it('should return 0 for future date (clock skew)', () => {
      const now = new Date();
      const futurePurchase = new Date(now.getTime() + MS_PER_DAY);
      const days = getDaysSinceLastPurchase(futurePurchase, now);
      expect(days).toBe(0);
    });
  });

  describe('getDormancyLevel', () => {
    it('should return null for < 60 days (active)', () => {
      const now = new Date();
      const lastPurchase = new Date(now.getTime() - 59 * MS_PER_DAY);
      expect(getDormancyLevel(lastPurchase, now)).toBeNull();
    });

    it('should return "at_risk" for 60–89 days', () => {
      const now = new Date();

      const day60 = new Date(now.getTime() - 60 * MS_PER_DAY);
      expect(getDormancyLevel(day60, now)).toBe('at_risk');

      const day89 = new Date(now.getTime() - 89 * MS_PER_DAY);
      expect(getDormancyLevel(day89, now)).toBe('at_risk');
    });

    it('should return "dormant" for 90–179 days', () => {
      const now = new Date();

      const day90 = new Date(now.getTime() - 90 * MS_PER_DAY);
      expect(getDormancyLevel(day90, now)).toBe('dormant');

      const day179 = new Date(now.getTime() - 179 * MS_PER_DAY);
      expect(getDormancyLevel(day179, now)).toBe('dormant');
    });

    it('should return "churned" for 180+ days', () => {
      const now = new Date();

      const day180 = new Date(now.getTime() - 180 * MS_PER_DAY);
      expect(getDormancyLevel(day180, now)).toBe('churned');

      const day365 = new Date(now.getTime() - 365 * MS_PER_DAY);
      expect(getDormancyLevel(day365, now)).toBe('churned');
    });
  });
});
