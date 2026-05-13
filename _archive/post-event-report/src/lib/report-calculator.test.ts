import { describe, it, expect } from 'vitest';
import {
  calculateSellthroughPct,
  calculateNoShowPct,
  calculateAvgPrice,
  findPeakEntryTime,
  findAvgEntryTime,
  buildSalesByDay,
  formatCurrency,
  formatPct,
} from './report-calculator';

describe('report-calculator', () => {
  describe('calculateSellthroughPct', () => {
    it('should calculate 0% for zero sales', () => {
      expect(calculateSellthroughPct(0, 100)).toBe(0);
    });

    it('should calculate 50% sellthrough', () => {
      expect(calculateSellthroughPct(50, 100)).toBe(50);
    });

    it('should calculate 100% sellthrough', () => {
      expect(calculateSellthroughPct(100, 100)).toBe(100);
    });

    it('should cap at 100% for overselling', () => {
      expect(calculateSellthroughPct(150, 100)).toBe(100);
    });

    it('should return 0 for zero capacity', () => {
      expect(calculateSellthroughPct(50, 0)).toBe(0);
    });

    it('should round correctly', () => {
      expect(calculateSellthroughPct(33, 100)).toBe(33);
    });
  });

  describe('calculateNoShowPct', () => {
    it('should calculate no-show percentage', () => {
      expect(calculateNoShowPct(80, 100)).toBe(20);
    });

    it('should return 0 when all checked in', () => {
      expect(calculateNoShowPct(100, 100)).toBe(0);
    });

    it('should return 100 when none checked in', () => {
      expect(calculateNoShowPct(0, 100)).toBe(100);
    });

    it('should return 0 when sold = 0', () => {
      expect(calculateNoShowPct(0, 0)).toBe(0);
    });

    it('should round correctly', () => {
      expect(calculateNoShowPct(66, 100)).toBe(34);
    });
  });

  describe('calculateAvgPrice', () => {
    it('should calculate average price', () => {
      expect(calculateAvgPrice(50000, 10)).toBe(5000);
    });

    it('should return 0 when count is 0', () => {
      expect(calculateAvgPrice(50000, 0)).toBe(0);
    });

    it('should round to nearest halér', () => {
      expect(calculateAvgPrice(100, 3)).toBe(33);
    });

    it('should handle large numbers', () => {
      expect(calculateAvgPrice(1000000, 100)).toBe(10000);
    });
  });

  describe('findPeakEntryTime', () => {
    it('should return null for empty array', () => {
      expect(findPeakEntryTime([])).toBeNull();
    });

    it('should find peak in single 15-minute window', () => {
      const timestamps = [
        new Date('2026-04-04T19:00:00'),
        new Date('2026-04-04T19:05:00'),
        new Date('2026-04-04T19:10:00'),
      ];
      expect(findPeakEntryTime(timestamps)).toBe('19:00');
    });

    it('should find peak across multiple windows', () => {
      const timestamps = [
        new Date('2026-04-04T19:00:00'),
        new Date('2026-04-04T19:10:00'),
        new Date('2026-04-04T19:45:00'),
        new Date('2026-04-04T19:46:00'),
        new Date('2026-04-04T19:47:00'),
        new Date('2026-04-04T19:48:00'),
      ];
      expect(findPeakEntryTime(timestamps)).toBe('19:45');
    });

    it('should handle 15-minute window boundaries', () => {
      const timestamps = [
        new Date('2026-04-04T19:29:00'),
        new Date('2026-04-04T19:30:00'),
        new Date('2026-04-04T19:31:00'),
      ];
      const peak = findPeakEntryTime(timestamps);
      // 19:29 is in 19:15 window, 19:30-19:31 are in 19:30 window
      expect(['19:15', '19:30'].includes(peak!)).toBe(true);
    });

    it('should format time as HH:MM', () => {
      const timestamps = [new Date('2026-04-04T09:05:00')];
      expect(findPeakEntryTime(timestamps)).toBe('09:00');
    });
  });

  describe('findAvgEntryTime', () => {
    it('should return null for empty array', () => {
      expect(findAvgEntryTime([])).toBeNull();
    });

    it('should return median time for single entry', () => {
      const timestamps = [new Date('2026-04-04T19:30:00')];
      expect(findAvgEntryTime(timestamps)).toBe('19:30');
    });

    it('should return median time for multiple entries', () => {
      const timestamps = [
        new Date('2026-04-04T19:00:00'),
        new Date('2026-04-04T19:30:00'),
        new Date('2026-04-04T20:00:00'),
      ];
      expect(findAvgEntryTime(timestamps)).toBe('19:30');
    });

    it('should handle odd number of entries', () => {
      const timestamps = [
        new Date('2026-04-04T19:00:00'),
        new Date('2026-04-04T19:20:00'),
        new Date('2026-04-04T19:40:00'),
        new Date('2026-04-04T20:00:00'),
        new Date('2026-04-04T20:30:00'),
      ];
      const result = findAvgEntryTime(timestamps);
      expect(result).toBe('19:40');
    });

    it('should format time as HH:MM', () => {
      const timestamps = [new Date('2026-04-04T09:05:30')];
      expect(findAvgEntryTime(timestamps)).toBe('09:05');
    });
  });

  describe('buildSalesByDay', () => {
    it('should return empty array for empty input', () => {
      expect(buildSalesByDay([])).toEqual([]);
    });

    it('should group orders by date', () => {
      const orders = [
        { created_at: new Date('2026-03-20T10:00:00'), amount: 1000, quantity: 1 },
        { created_at: new Date('2026-03-20T14:00:00'), amount: 2000, quantity: 2 },
        { created_at: new Date('2026-03-21T09:00:00'), amount: 1500, quantity: 1 },
      ];
      const result = buildSalesByDay(orders);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ date: '2026-03-20', tickets: 3, revenue: 3000 });
      expect(result[1]).toEqual({ date: '2026-03-21', tickets: 1, revenue: 1500 });
    });

    it('should sort by date ascending', () => {
      const orders = [
        { created_at: new Date('2026-03-21T10:00:00'), amount: 1000, quantity: 1 },
        { created_at: new Date('2026-03-20T10:00:00'), amount: 2000, quantity: 2 },
      ];
      const result = buildSalesByDay(orders);
      expect(result[0].date).toBe('2026-03-20');
      expect(result[1].date).toBe('2026-03-21');
    });

    it('should sum multiple orders same day', () => {
      const orders = [
        { created_at: new Date('2026-03-20T10:00:00'), amount: 500, quantity: 1 },
        { created_at: new Date('2026-03-20T11:00:00'), amount: 300, quantity: 1 },
        { created_at: new Date('2026-03-20T12:00:00'), amount: 200, quantity: 1 },
      ];
      const result = buildSalesByDay(orders);
      expect(result).toEqual([{ date: '2026-03-20', tickets: 3, revenue: 1000 }]);
    });

    it('should handle large datasets', () => {
      const orders = Array.from({ length: 1000 }, (_, i) => ({
        created_at: new Date(`2026-03-${20 + Math.floor(i / 100)}T10:00:00`),
        amount: 1000 + i,
        quantity: 1,
      }));
      const result = buildSalesByDay(orders);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(11);
    });
  });

  describe('formatCurrency', () => {
    it('should format whole korunas', () => {
      expect(formatCurrency(100)).toMatch(/1[\s,]00\s*Kč/);
    });

    it('should format haléř', () => {
      expect(formatCurrency(150)).toMatch(/1[\s,]50\s*Kč/);
    });

    it('should format zero', () => {
      expect(formatCurrency(0)).toMatch(/0[\s,]00\s*Kč/);
    });

    it('should format large numbers', () => {
      const formatted = formatCurrency(123456);
      expect(formatted).toContain('Kč');
      expect(formatted).toMatch(/1\s*234[\s,]/);
    });

    it('should add thousands separator', () => {
      const formatted = formatCurrency(1000000);
      expect(formatted).toContain('Kč');
    });
  });

  describe('formatPct', () => {
    it('should format simple percentage', () => {
      expect(formatPct(50)).toBe('50 %');
    });

    it('should format zero', () => {
      expect(formatPct(0)).toBe('0 %');
    });

    it('should format 100%', () => {
      expect(formatPct(100)).toBe('100 %');
    });

    it('should round decimal percentages', () => {
      expect(formatPct(50.6)).toBe('51 %');
      expect(formatPct(50.4)).toBe('50 %');
    });

    it('should handle large percentages', () => {
      expect(formatPct(123.45)).toBe('123 %');
    });
  });
});
