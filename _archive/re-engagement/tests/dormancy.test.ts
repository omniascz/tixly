import { describe, it, expect } from 'vitest';
import { getDaysSinceLastPurchase, getDormancyLevel } from '../src/lib/dormancy';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

const NOW = new Date('2026-04-05T12:00:00.000Z');

// ─── getDaysSinceLastPurchase ─────────────────────────────────────────────────

describe('getDaysSinceLastPurchase', () => {
  it('returns 0 for a purchase made today', () => {
    expect(getDaysSinceLastPurchase(NOW, NOW)).toBe(0);
  });

  it('returns 1 for a purchase exactly 1 day ago', () => {
    expect(getDaysSinceLastPurchase(daysAgo(1, NOW), NOW)).toBe(1);
  });

  it('returns 59 for a purchase 59 days ago', () => {
    expect(getDaysSinceLastPurchase(daysAgo(59, NOW), NOW)).toBe(59);
  });

  it('returns 90 for a purchase exactly 90 days ago', () => {
    expect(getDaysSinceLastPurchase(daysAgo(90, NOW), NOW)).toBe(90);
  });

  it('returns 180 for a purchase exactly 180 days ago', () => {
    expect(getDaysSinceLastPurchase(daysAgo(180, NOW), NOW)).toBe(180);
  });

  it('returns 0 (clamped) when lastPurchaseAt is in the future (clock skew)', () => {
    const future = new Date(NOW.getTime() + 1000 * 60 * 60); // 1 hour ahead
    expect(getDaysSinceLastPurchase(future, NOW)).toBe(0);
  });

  it('uses Math.floor — 89.9 days counts as 89', () => {
    const almostNinety = new Date(NOW.getTime() - 89.9 * 24 * 60 * 60 * 1000);
    expect(getDaysSinceLastPurchase(almostNinety, NOW)).toBe(89);
  });
});

// ─── getDormancyLevel ─────────────────────────────────────────────────────────

describe('getDormancyLevel', () => {
  it('returns null for 0 days (active user)', () => {
    expect(getDormancyLevel(NOW, NOW)).toBeNull();
  });

  it('returns null for 30 days (still active)', () => {
    expect(getDormancyLevel(daysAgo(30, NOW), NOW)).toBeNull();
  });

  it('returns null for 59 days (just below at_risk)', () => {
    expect(getDormancyLevel(daysAgo(59, NOW), NOW)).toBeNull();
  });

  it('returns at_risk for exactly 60 days', () => {
    expect(getDormancyLevel(daysAgo(60, NOW), NOW)).toBe('at_risk');
  });

  it('returns at_risk for 75 days (mid at_risk range)', () => {
    expect(getDormancyLevel(daysAgo(75, NOW), NOW)).toBe('at_risk');
  });

  it('returns at_risk for 89 days (upper edge of at_risk)', () => {
    expect(getDormancyLevel(daysAgo(89, NOW), NOW)).toBe('at_risk');
  });

  it('returns dormant for exactly 90 days', () => {
    expect(getDormancyLevel(daysAgo(90, NOW), NOW)).toBe('dormant');
  });

  it('returns dormant for 135 days (mid dormant range)', () => {
    expect(getDormancyLevel(daysAgo(135, NOW), NOW)).toBe('dormant');
  });

  it('returns dormant for 179 days (upper edge of dormant)', () => {
    expect(getDormancyLevel(daysAgo(179, NOW), NOW)).toBe('dormant');
  });

  it('returns churned for exactly 180 days', () => {
    expect(getDormancyLevel(daysAgo(180, NOW), NOW)).toBe('churned');
  });

  it('returns churned for 365 days (heavily inactive)', () => {
    expect(getDormancyLevel(daysAgo(365, NOW), NOW)).toBe('churned');
  });

  it('returns null for future lastPurchaseAt (clamped to 0 days)', () => {
    const future = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000);
    expect(getDormancyLevel(future, NOW)).toBeNull();
  });
});
