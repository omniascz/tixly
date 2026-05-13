import { describe, it, expect } from 'vitest';
import {
  calculateFlashPrice,
  calculateDiscountPct,
  calculateSecondsRemaining,
  isFlashSaleActive,
  toPublicView,
  validateFlashSaleTimes,
} from './flash-sale-calculator';
import type { FlashSale } from '../types/flash-sale.types';
import { FlashSaleInvalidTimeError } from '../types/flash-sale.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-04-04T12:00:00Z');
const PAST = new Date('2026-04-04T11:00:00Z');
const FUTURE_START = new Date('2026-04-04T13:00:00Z');
const FUTURE_END = new Date('2026-04-04T15:00:00Z');

function makeSale(overrides: Partial<FlashSale> = {}): FlashSale {
  return {
    id: 'fs-1',
    event_id: 'ev-1',
    ticket_type_id: 'tt-1',
    name: 'Flash Sale Test',
    discount_type: 'percentage',
    discount_value: 20,
    flash_capacity: 100,
    flash_sold_count: 0,
    original_price: 10000,
    flash_price: 8000,
    starts_at: PAST,
    ends_at: FUTURE_END,
    status: 'active',
    created_by_organizer_id: 'org-1',
    created_at: new Date('2026-04-04T10:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// calculateFlashPrice
// ---------------------------------------------------------------------------

describe('calculateFlashPrice', () => {
  it('applies percentage discount correctly', () => {
    // 10000 * (1 - 30/100) = 7000
    expect(calculateFlashPrice(10000, 'percentage', 30)).toBe(7000);
  });

  it('floors the result for percentage (no rounding up)', () => {
    // 10000 * (1 - 33/100) = 6700 exactly — check non-integer
    // 9999 * (1 - 33/100) = 9999 * 0.67 = 6699.33 → floor → 6699
    expect(calculateFlashPrice(9999, 'percentage', 33)).toBe(6699);
  });

  it('applies fixed discount correctly', () => {
    expect(calculateFlashPrice(10000, 'fixed', 2500)).toBe(7500);
  });

  it('enforces minimum of 1 haléř for percentage (100% discount)', () => {
    expect(calculateFlashPrice(10000, 'percentage', 100)).toBe(1);
  });

  it('enforces minimum of 1 haléř when fixed discount exceeds original price', () => {
    expect(calculateFlashPrice(5000, 'fixed', 6000)).toBe(1);
  });

  it('enforces minimum of 1 haléř for fixed discount equal to original price', () => {
    expect(calculateFlashPrice(5000, 'fixed', 5000)).toBe(1);
  });

  it('returns original price when percentage discount is 0', () => {
    expect(calculateFlashPrice(10000, 'percentage', 0)).toBe(10000);
  });

  it('returns original price when fixed discount is 0', () => {
    expect(calculateFlashPrice(10000, 'fixed', 0)).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// calculateDiscountPct
// ---------------------------------------------------------------------------

describe('calculateDiscountPct', () => {
  it('calculates 25% discount correctly', () => {
    expect(calculateDiscountPct(10000, 7500)).toBe(25);
  });

  it('rounds to nearest whole percent', () => {
    // (10000 - 6667) / 10000 = 0.3333 → 33%
    expect(calculateDiscountPct(10000, 6667)).toBe(33);
  });

  it('returns 0 for no discount (same price)', () => {
    expect(calculateDiscountPct(10000, 10000)).toBe(0);
  });

  it('returns 0 when original price is 0 (guard against division by zero)', () => {
    expect(calculateDiscountPct(0, 0)).toBe(0);
  });

  it('returns 100 for full discount (price = 0)', () => {
    expect(calculateDiscountPct(10000, 0)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// calculateSecondsRemaining
// ---------------------------------------------------------------------------

describe('calculateSecondsRemaining', () => {
  it('returns correct seconds when ends_at is in the future', () => {
    const endsAt = new Date(NOW.getTime() + 3600 * 1000); // +1 hour
    expect(calculateSecondsRemaining(endsAt, NOW)).toBe(3600);
  });

  it('returns 0 when ends_at equals now', () => {
    expect(calculateSecondsRemaining(NOW, NOW)).toBe(0);
  });

  it('returns 0 when ends_at is in the past (never negative)', () => {
    const endsAt = new Date(NOW.getTime() - 5000);
    expect(calculateSecondsRemaining(endsAt, NOW)).toBe(0);
  });

  it('floors partial seconds (does not round up)', () => {
    const endsAt = new Date(NOW.getTime() + 1500); // 1.5 seconds
    expect(calculateSecondsRemaining(endsAt, NOW)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// isFlashSaleActive
// ---------------------------------------------------------------------------

describe('isFlashSaleActive', () => {
  it('returns true for a well-formed active sale', () => {
    const sale = makeSale({ status: 'active' });
    expect(isFlashSaleActive(sale, NOW)).toBe(true);
  });

  it('returns false when status is scheduled', () => {
    const sale = makeSale({ status: 'scheduled' });
    expect(isFlashSaleActive(sale, NOW)).toBe(false);
  });

  it('returns false when status is ended', () => {
    const sale = makeSale({ status: 'ended' });
    expect(isFlashSaleActive(sale, NOW)).toBe(false);
  });

  it('returns false when status is cancelled', () => {
    const sale = makeSale({ status: 'cancelled' });
    expect(isFlashSaleActive(sale, NOW)).toBe(false);
  });

  it('returns false when now is before starts_at', () => {
    const sale = makeSale({
      status: 'active',
      starts_at: FUTURE_START,  // starts in the future
      ends_at: FUTURE_END,
    });
    expect(isFlashSaleActive(sale, NOW)).toBe(false);
  });

  it('returns false when now is exactly at ends_at (exclusive upper bound)', () => {
    const sale = makeSale({
      status: 'active',
      starts_at: PAST,
      ends_at: NOW, // exactly now = expired
    });
    expect(isFlashSaleActive(sale, NOW)).toBe(false);
  });

  it('returns false when now is after ends_at', () => {
    const sale = makeSale({
      status: 'active',
      starts_at: PAST,
      ends_at: new Date(NOW.getTime() - 1000),
    });
    expect(isFlashSaleActive(sale, NOW)).toBe(false);
  });

  it('returns false when sold_out (flash_sold_count >= flash_capacity)', () => {
    const sale = makeSale({
      status: 'active',
      flash_capacity: 50,
      flash_sold_count: 50,
    });
    expect(isFlashSaleActive(sale, NOW)).toBe(false);
  });

  it('returns false when flash_sold_count exceeds flash_capacity', () => {
    const sale = makeSale({
      status: 'active',
      flash_capacity: 50,
      flash_sold_count: 51,
    });
    expect(isFlashSaleActive(sale, NOW)).toBe(false);
  });

  it('returns true when one ticket remains', () => {
    const sale = makeSale({
      status: 'active',
      flash_capacity: 50,
      flash_sold_count: 49,
    });
    expect(isFlashSaleActive(sale, NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toPublicView
// ---------------------------------------------------------------------------

describe('toPublicView', () => {
  it('returns correct fields for an active sale with remaining capacity', () => {
    const sale = makeSale({
      flash_capacity: 100,
      flash_sold_count: 40,
      original_price: 10000,
      flash_price: 7000,
    });

    const view = toPublicView(sale, NOW);

    expect(view.id).toBe('fs-1');
    expect(view.name).toBe('Flash Sale Test');
    expect(view.flash_price).toBe(7000);
    expect(view.original_price).toBe(10000);
    expect(view.discount_pct).toBe(30);
    expect(view.remaining_count).toBe(60);
    expect(view.status).toBe('active');
    expect(view.seconds_remaining).toBeGreaterThan(0);
    expect(view.ends_at).toEqual(FUTURE_END);
  });

  it('returns status sold_out when flash_sold_count equals flash_capacity', () => {
    const sale = makeSale({
      flash_capacity: 50,
      flash_sold_count: 50,
      status: 'active',
    });
    const view = toPublicView(sale, NOW);
    expect(view.status).toBe('sold_out');
    expect(view.remaining_count).toBe(0);
  });

  it('returns status ended when sale status is ended', () => {
    const sale = makeSale({ status: 'ended' });
    const view = toPublicView(sale, NOW);
    expect(view.status).toBe('ended');
  });

  it('returns status ended when ends_at has passed even if status is active', () => {
    const sale = makeSale({
      status: 'active',
      ends_at: new Date(NOW.getTime() - 1000), // 1 second ago
    });
    const view = toPublicView(sale, NOW);
    expect(view.status).toBe('ended');
  });

  it('returns seconds_remaining = 0 when sale has ended', () => {
    const sale = makeSale({
      status: 'ended',
      ends_at: new Date(NOW.getTime() - 5000),
    });
    const view = toPublicView(sale, NOW);
    expect(view.seconds_remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// validateFlashSaleTimes
// ---------------------------------------------------------------------------

describe('validateFlashSaleTimes', () => {
  it('does not throw for valid future times', () => {
    expect(() =>
      validateFlashSaleTimes(FUTURE_START, FUTURE_END, NOW),
    ).not.toThrow();
  });

  it('throws FlashSaleInvalidTimeError when starts_at is in the past', () => {
    expect(() =>
      validateFlashSaleTimes(PAST, FUTURE_END, NOW),
    ).toThrow(FlashSaleInvalidTimeError);
  });

  it('throws FlashSaleInvalidTimeError when ends_at equals starts_at', () => {
    expect(() =>
      validateFlashSaleTimes(FUTURE_START, FUTURE_START, NOW),
    ).toThrow(FlashSaleInvalidTimeError);
  });

  it('throws FlashSaleInvalidTimeError when ends_at is before starts_at', () => {
    expect(() =>
      validateFlashSaleTimes(FUTURE_END, FUTURE_START, NOW),
    ).toThrow(FlashSaleInvalidTimeError);
  });

  it('includes a descriptive message when starts_at is in the past', () => {
    try {
      validateFlashSaleTimes(PAST, FUTURE_END, NOW);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FlashSaleInvalidTimeError);
      expect((err as FlashSaleInvalidTimeError).message).toMatch(/starts_at/);
      expect((err as FlashSaleInvalidTimeError).message).toMatch(/past/);
    }
  });

  it('includes a descriptive message when ends_at <= starts_at', () => {
    try {
      validateFlashSaleTimes(FUTURE_START, FUTURE_START, NOW);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FlashSaleInvalidTimeError);
      expect((err as FlashSaleInvalidTimeError).message).toMatch(/ends_at/);
      expect((err as FlashSaleInvalidTimeError).message).toMatch(/starts_at/);
    }
  });

  it('does not throw when starts_at equals now exactly', () => {
    // starts_at === now is NOT in the past (strict <), should be allowed
    expect(() =>
      validateFlashSaleTimes(NOW, FUTURE_END, NOW),
    ).not.toThrow();
  });
});
