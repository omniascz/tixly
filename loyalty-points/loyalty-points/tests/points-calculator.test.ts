import { describe, it, expect } from 'vitest';
import {
  calculateEarnedPoints,
  getTier,
  calculateDiscount,
  calculateExpiryDate,
} from '../src/lib/points-calculator';
import { TIER_THRESHOLDS, TIER_MULTIPLIERS } from '../src/types/loyalty.types';

// ---------------------------------------------------------------------------
// calculateEarnedPoints
// ---------------------------------------------------------------------------

describe('calculateEarnedPoints', () => {
  it('bronze tier: 1 Kč = 1 bod', () => {
    expect(calculateEarnedPoints(100, 'bronze')).toBe(1);
  });

  it('bronze tier: 500 Kč = 500 bodů', () => {
    expect(calculateEarnedPoints(50_000, 'bronze')).toBe(500);
  });

  it('silver tier: 100 Kč × 1.5 = 150 bodů', () => {
    expect(calculateEarnedPoints(10_000, 'silver')).toBe(150);
  });

  it('gold tier: 100 Kč × 2 = 200 bodů', () => {
    expect(calculateEarnedPoints(10_000, 'gold')).toBe(200);
  });

  it('platinum tier: 100 Kč × 3 = 300 bodů', () => {
    expect(calculateEarnedPoints(10_000, 'platinum')).toBe(300);
  });

  it('výsledek je celé číslo (Math.floor) — silver 99 Kč 99 haléřů', () => {
    // 9999 haléřů / 100 = 99.99 Kč × 1.5 = 149.985 → floor → 149
    expect(calculateEarnedPoints(9_999, 'silver')).toBe(149);
  });

  it('platinum tier se zaokrouhlením dolů: 333 Kč × 3 = 999 bodů', () => {
    // 33300 / 100 * 3 = 999
    expect(calculateEarnedPoints(33_300, 'platinum')).toBe(999);
  });

  it('orderAmount = 0 vrátí 0 bodů', () => {
    expect(calculateEarnedPoints(0, 'bronze')).toBe(0);
  });

  it('záporný orderAmount vrátí 0 bodů', () => {
    expect(calculateEarnedPoints(-100, 'gold')).toBe(0);
  });

  it('velká objednávka 10 000 Kč, platinum: 30 000 bodů', () => {
    expect(calculateEarnedPoints(1_000_000, 'platinum')).toBe(30_000);
  });

  it('multiplikátory odpovídají TIER_MULTIPLIERS', () => {
    const amount = 10_000; // 100 Kč
    const koruny = amount / 100;
    expect(calculateEarnedPoints(amount, 'bronze')).toBe(Math.floor(koruny * TIER_MULTIPLIERS.bronze));
    expect(calculateEarnedPoints(amount, 'silver')).toBe(Math.floor(koruny * TIER_MULTIPLIERS.silver));
    expect(calculateEarnedPoints(amount, 'gold')).toBe(Math.floor(koruny * TIER_MULTIPLIERS.gold));
    expect(calculateEarnedPoints(amount, 'platinum')).toBe(Math.floor(koruny * TIER_MULTIPLIERS.platinum));
  });
});

// ---------------------------------------------------------------------------
// getTier
// ---------------------------------------------------------------------------

describe('getTier', () => {
  it('0 bodů → bronze', () => {
    expect(getTier(0)).toBe('bronze');
  });

  it('4999 bodů → bronze (těsně pod silver)', () => {
    expect(getTier(4_999)).toBe('bronze');
  });

  it('5000 bodů → silver (přesný práh)', () => {
    expect(getTier(TIER_THRESHOLDS.silver)).toBe('silver');
  });

  it('10 000 bodů → silver', () => {
    expect(getTier(10_000)).toBe('silver');
  });

  it('19 999 bodů → silver (těsně pod gold)', () => {
    expect(getTier(19_999)).toBe('silver');
  });

  it('20 000 bodů → gold (přesný práh)', () => {
    expect(getTier(TIER_THRESHOLDS.gold)).toBe('gold');
  });

  it('35 000 bodů → gold', () => {
    expect(getTier(35_000)).toBe('gold');
  });

  it('49 999 bodů → gold (těsně pod platinum)', () => {
    expect(getTier(49_999)).toBe('gold');
  });

  it('50 000 bodů → platinum (přesný práh)', () => {
    expect(getTier(TIER_THRESHOLDS.platinum)).toBe('platinum');
  });

  it('100 000 bodů → platinum', () => {
    expect(getTier(100_000)).toBe('platinum');
  });

  it('záporné hodnoty → bronze (edge case)', () => {
    expect(getTier(-1)).toBe('bronze');
  });
});

// ---------------------------------------------------------------------------
// calculateDiscount
// ---------------------------------------------------------------------------

describe('calculateDiscount', () => {
  it('0 bodů → 0 haléřů', () => {
    expect(calculateDiscount(0)).toBe(0);
  });

  it('100 bodů → 100 haléřů (1 Kč)', () => {
    expect(calculateDiscount(100)).toBe(100);
  });

  it('500 bodů → 500 haléřů (5 Kč)', () => {
    expect(calculateDiscount(500)).toBe(500);
  });

  it('1000 bodů → 1000 haléřů (10 Kč)', () => {
    expect(calculateDiscount(1_000)).toBe(1_000);
  });

  it('záporný vstup → 0 haléřů', () => {
    expect(calculateDiscount(-50)).toBe(0);
  });

  it('výsledek je celé číslo', () => {
    const result = calculateDiscount(333);
    expect(Number.isInteger(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// calculateExpiryDate
// ---------------------------------------------------------------------------

describe('calculateExpiryDate', () => {
  it('přidá přesně 12 měsíců', () => {
    const from = new Date('2026-04-05T12:00:00Z');
    const expiry = calculateExpiryDate(from);
    expect(expiry.getUTCFullYear()).toBe(2027);
    expect(expiry.getUTCMonth()).toBe(3); // duben = 3 (0-indexed)
    expect(expiry.getUTCDate()).toBe(5);
  });

  it('zachová čas (hodiny, minuty, sekundy)', () => {
    const from = new Date('2026-01-15T08:30:45Z');
    const expiry = calculateExpiryDate(from);
    expect(expiry.getUTCHours()).toBe(8);
    expect(expiry.getUTCMinutes()).toBe(30);
    expect(expiry.getUTCSeconds()).toBe(45);
  });

  it('správně přeskočí přes konec roku', () => {
    const from = new Date('2026-07-20T00:00:00Z');
    const expiry = calculateExpiryDate(from);
    expect(expiry.getUTCFullYear()).toBe(2027);
    expect(expiry.getUTCMonth()).toBe(6); // červenec = 6
  });

  it('vrátí nový Date objekt (nemutuje vstup)', () => {
    const from = new Date('2026-04-05T00:00:00Z');
    const original = from.getTime();
    calculateExpiryDate(from);
    expect(from.getTime()).toBe(original);
  });

  it('expiry je vždy v budoucnosti (při normálním použití)', () => {
    const now = new Date();
    const expiry = calculateExpiryDate(now);
    expect(expiry.getTime()).toBeGreaterThan(now.getTime());
  });
});
