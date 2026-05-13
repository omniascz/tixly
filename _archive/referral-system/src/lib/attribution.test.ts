import { describe, it, expect } from 'vitest';
import {
  getLastClickAttribution,
  getFirstClickAttribution,
  getLinearAttribution,
  isWithinConversionWindow,
  calculateCommission,
  CONVERSION_WINDOW_DAYS,
} from './attribution';
import type { ReferralClick } from '../types/referral.types';

// ============================================================
// attribution.ts — unit tests
// ============================================================

// ─── Helpers ──────────────────────────────────────────────────

let idCounter = 1n;
function makeClick(
  occurredAt: Date,
  linkId = 'link-1',
  converted = false,
): ReferralClick {
  return {
    id: idCounter++,
    linkId,
    referrerCode: 'AbCd1234',
    visitorId: 'visitor-abc',
    sessionId: 'session-xyz',
    ipHash: 'hash-ip',
    userAgentHash: 'hash-ua',
    occurredAt,
    converted,
    convertedAt: null,
  };
}

const NOW = new Date('2026-04-04T12:00:00Z');
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60 * 1000);

// ─── isWithinConversionWindow ─────────────────────────────────

describe('isWithinConversionWindow', () => {
  it('returns true when click is exactly on the conversion date', () => {
    expect(isWithinConversionWindow(NOW, NOW, 30)).toBe(true);
  });

  it('returns true when click is 1 day before conversion', () => {
    expect(isWithinConversionWindow(daysAgo(1), NOW, 30)).toBe(true);
  });

  it('returns true when click is exactly 30 days before conversion', () => {
    const exactly30 = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(isWithinConversionWindow(exactly30, NOW, 30)).toBe(true);
  });

  it('returns false when click is 30 days + 1 minute before conversion', () => {
    const tooOld = new Date(
      NOW.getTime() - 30 * 24 * 60 * 60 * 1000 - 60 * 1000,
    );
    expect(isWithinConversionWindow(tooOld, NOW, 30)).toBe(false);
  });

  it('returns false when click is in the future relative to conversion', () => {
    const future = new Date(NOW.getTime() + 1000);
    expect(isWithinConversionWindow(future, NOW, 30)).toBe(false);
  });

  it('respects a custom windowDays parameter', () => {
    // 7-day window: 6 days ago should pass, 8 days ago should fail
    expect(isWithinConversionWindow(daysAgo(6), NOW, 7)).toBe(true);
    expect(isWithinConversionWindow(daysAgo(8), NOW, 7)).toBe(false);
  });
});

// ─── getLastClickAttribution ──────────────────────────────────

describe('getLastClickAttribution', () => {
  it('returns null for an empty click array', () => {
    expect(getLastClickAttribution([], NOW)).toBeNull();
  });

  it('returns the single click when only one exists within window', () => {
    const click = makeClick(daysAgo(1));
    expect(getLastClickAttribution([click], NOW)).toBe(click);
  });

  it('returns the most recent click among multiple', () => {
    const old = makeClick(daysAgo(10));
    const recent = makeClick(daysAgo(2));
    const mid = makeClick(daysAgo(5));
    const result = getLastClickAttribution([old, mid, recent], NOW);
    expect(result).toBe(recent);
  });

  it('returns null when the only click is outside the conversion window', () => {
    const expired = makeClick(daysAgo(31));
    expect(getLastClickAttribution([expired], NOW)).toBeNull();
  });

  it('ignores expired clicks and returns the newest in-window click', () => {
    const expired = makeClick(daysAgo(35));
    const valid = makeClick(daysAgo(5));
    const result = getLastClickAttribution([expired, valid], NOW);
    expect(result).toBe(valid);
  });

  it('uses default conversionAt = now when not provided', () => {
    const recent = makeClick(minutesAgo(5));
    const result = getLastClickAttribution([recent]);
    expect(result).toBe(recent);
  });
});

// ─── getFirstClickAttribution ─────────────────────────────────

describe('getFirstClickAttribution', () => {
  it('returns null for an empty click array', () => {
    expect(getFirstClickAttribution([], NOW)).toBeNull();
  });

  it('returns the single click when only one exists', () => {
    const click = makeClick(daysAgo(1));
    expect(getFirstClickAttribution([click], NOW)).toBe(click);
  });

  it('returns the oldest click among multiple in-window clicks', () => {
    const old = makeClick(daysAgo(20));
    const mid = makeClick(daysAgo(10));
    const recent = makeClick(daysAgo(2));
    const result = getFirstClickAttribution([recent, mid, old], NOW);
    expect(result).toBe(old);
  });

  it('returns null when all clicks are outside the conversion window', () => {
    const expired = makeClick(daysAgo(40));
    expect(getFirstClickAttribution([expired], NOW)).toBeNull();
  });
});

// ─── getLinearAttribution ─────────────────────────────────────

describe('getLinearAttribution', () => {
  it('returns empty array when clicks array is empty', () => {
    expect(getLinearAttribution([], 100, NOW)).toHaveLength(0);
  });

  it('assigns 100% to the single eligible click', () => {
    const click = makeClick(daysAgo(1));
    const shares = getLinearAttribution([click], 100, NOW);
    expect(shares).toHaveLength(1);
    expect(shares[0].amount).toBe(100);
  });

  it('distributes evenly across 3 clicks', () => {
    const clicks = [
      makeClick(daysAgo(1)),
      makeClick(daysAgo(5)),
      makeClick(daysAgo(10)),
    ];
    const shares = getLinearAttribution(clicks, 99, NOW);
    expect(shares).toHaveLength(3);
    shares.forEach((s) => expect(s.amount).toBeCloseTo(33, 1));
  });

  it('total of shares equals totalAmount', () => {
    const clicks = [
      makeClick(daysAgo(1)),
      makeClick(daysAgo(5)),
      makeClick(daysAgo(10)),
    ];
    const total = 100;
    const shares = getLinearAttribution(clicks, total, NOW);
    const sum = shares.reduce((acc, s) => acc + s.amount, 0);
    expect(Math.round(sum * 100)).toBe(Math.round(total * 100));
  });

  it('excludes expired clicks from the distribution', () => {
    const expired = makeClick(daysAgo(35));
    const valid1 = makeClick(daysAgo(2));
    const valid2 = makeClick(daysAgo(8));
    const shares = getLinearAttribution([expired, valid1, valid2], 100, NOW);
    expect(shares).toHaveLength(2);
    expect(shares.every((s) => s.amount === 50)).toBe(true);
  });

  it('populates linkId and clickId from the click record', () => {
    const click = makeClick(daysAgo(1), 'link-special');
    const shares = getLinearAttribution([click], 50, NOW);
    expect(shares[0].linkId).toBe('link-special');
    expect(shares[0].clickId).toBe(click.id);
  });
});

// ─── calculateCommission ──────────────────────────────────────

describe('calculateCommission', () => {
  it('calculates 5% of 1000 CZK as 50 CZK', () => {
    expect(calculateCommission(1000, 0.05)).toBe(50);
  });

  it('calculates 5% of 2500 CZK as 125 CZK', () => {
    expect(calculateCommission(2500, 0.05)).toBe(125);
  });

  it('rounds fractional result to nearest integer', () => {
    // 333 * 0.05 = 16.65 → rounds to 17
    expect(calculateCommission(333, 0.05)).toBe(17);
  });

  it('returns 0 for zero order amount', () => {
    expect(calculateCommission(0, 0.05)).toBe(0);
  });

  it('works with custom commission rate', () => {
    expect(calculateCommission(1000, 0.10)).toBe(100);
  });
});
