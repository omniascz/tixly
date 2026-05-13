import { describe, it, expect } from 'vitest';
import {
  calculateAvailableForHoldback,
  calculateEffectiveAvailable,
  shouldAutoRelease,
  validateHoldbackQuantity,
  calculateReleasedQty,
  calculateSellThroughPct,
} from './holdback-calculator';
import {
  HoldbackReleaseType,
  HoldbackStatus,
  InsufficientInventoryError,
  InvalidReleaseQuantityError,
} from '../types/holdback.types';
import type { InventoryHoldback } from '../types/holdback.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-04-04T12:00:00Z');
const PAST = new Date('2026-04-01T00:00:00Z');
const FUTURE = new Date('2026-04-10T00:00:00Z');

function makeHoldback(overrides: Partial<InventoryHoldback> = {}): InventoryHoldback {
  return {
    id: 'hb-1',
    ticketTypeId: 'tt-1',
    eventId: 'ev-1',
    organizerId: 'org-1',
    name: 'VIP Presale',
    quantity: 100,
    quantityReleased: 0,
    releaseType: HoldbackReleaseType.Manual,
    releaseAt: null,
    releaseTriggerPct: null,
    accessCode: null,
    status: HoldbackStatus.Active,
    notes: null,
    createdAt: new Date('2026-04-01T00:00:00Z'),
    releasedAt: null,
    releasedBy: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// calculateAvailableForHoldback
// ---------------------------------------------------------------------------

describe('calculateAvailableForHoldback', () => {
  it('returns correct available when nothing is sold or held', () => {
    expect(calculateAvailableForHoldback(500, 0, 0)).toBe(500);
  });

  it('subtracts sold and existing holdbacks from total', () => {
    // 500 total - 200 sold - 100 held = 200
    expect(calculateAvailableForHoldback(500, 200, 100)).toBe(200);
  });

  it('returns 0 when everything is sold', () => {
    expect(calculateAvailableForHoldback(500, 500, 0)).toBe(0);
  });

  it('returns 0 when sold + holdbacks equals total', () => {
    expect(calculateAvailableForHoldback(500, 300, 200)).toBe(0);
  });

  it('clamps to 0 — never returns negative', () => {
    // Defensive: sold+held exceeds total (data inconsistency)
    expect(calculateAvailableForHoldback(500, 400, 200)).toBe(0);
  });

  it('works with zero total capacity', () => {
    expect(calculateAvailableForHoldback(0, 0, 0)).toBe(0);
  });

  it('handles exact boundary — 1 ticket remaining', () => {
    expect(calculateAvailableForHoldback(100, 99, 0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// calculateEffectiveAvailable
// ---------------------------------------------------------------------------

describe('calculateEffectiveAvailable', () => {
  it('public sees total minus sold minus active holdbacks', () => {
    // 1000 total - 400 sold - 150 holdback = 450 for public
    expect(calculateEffectiveAvailable(1000, 400, 150)).toBe(450);
  });

  it('returns 0 when fully sold out', () => {
    expect(calculateEffectiveAvailable(200, 200, 0)).toBe(0);
  });

  it('returns 0 when holdbacks cover all remaining', () => {
    // 200 total - 100 sold - 100 holdback = 0 public
    expect(calculateEffectiveAvailable(200, 100, 100)).toBe(0);
  });

  it('clamps to 0 — never returns negative', () => {
    expect(calculateEffectiveAvailable(100, 80, 30)).toBe(0);
  });

  it('shows correct count after partial holdback release', () => {
    // 500 total - 200 sold - 50 still held (was 100 holdback, 50 released) = 250
    expect(calculateEffectiveAvailable(500, 200, 50)).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// shouldAutoRelease
// ---------------------------------------------------------------------------

describe('shouldAutoRelease', () => {
  it('never auto-releases a manual holdback', () => {
    const hb = makeHoldback({ releaseType: HoldbackReleaseType.Manual });
    expect(shouldAutoRelease(hb, 90, NOW)).toBe(false);
  });

  it('does not auto-release a scheduled holdback before its release date', () => {
    const hb = makeHoldback({
      releaseType: HoldbackReleaseType.Scheduled,
      releaseAt: FUTURE,
    });
    expect(shouldAutoRelease(hb, 0, NOW)).toBe(false);
  });

  it('auto-releases a scheduled holdback on or after its release date', () => {
    const hb = makeHoldback({
      releaseType: HoldbackReleaseType.Scheduled,
      releaseAt: PAST,
    });
    expect(shouldAutoRelease(hb, 0, NOW)).toBe(true);
  });

  it('auto-releases a scheduled holdback exactly at release time', () => {
    const hb = makeHoldback({
      releaseType: HoldbackReleaseType.Scheduled,
      releaseAt: NOW,
    });
    expect(shouldAutoRelease(hb, 0, NOW)).toBe(true);
  });

  it('does not trigger-release at 79% when threshold is 80%', () => {
    const hb = makeHoldback({
      releaseType: HoldbackReleaseType.Trigger,
      releaseTriggerPct: 80,
    });
    expect(shouldAutoRelease(hb, 79, NOW)).toBe(false);
  });

  it('trigger-releases at exactly 80% when threshold is 80%', () => {
    const hb = makeHoldback({
      releaseType: HoldbackReleaseType.Trigger,
      releaseTriggerPct: 80,
    });
    expect(shouldAutoRelease(hb, 80, NOW)).toBe(true);
  });

  it('trigger-releases above threshold (85% >= 80%)', () => {
    const hb = makeHoldback({
      releaseType: HoldbackReleaseType.Trigger,
      releaseTriggerPct: 80,
    });
    expect(shouldAutoRelease(hb, 85, NOW)).toBe(true);
  });

  it('does not auto-release an already-released holdback', () => {
    const hb = makeHoldback({
      releaseType: HoldbackReleaseType.Scheduled,
      releaseAt: PAST,
      status: HoldbackStatus.Released,
    });
    expect(shouldAutoRelease(hb, 0, NOW)).toBe(false);
  });

  it('does not auto-release a cancelled holdback', () => {
    const hb = makeHoldback({
      releaseType: HoldbackReleaseType.Trigger,
      releaseTriggerPct: 50,
      status: HoldbackStatus.Cancelled,
    });
    expect(shouldAutoRelease(hb, 99, NOW)).toBe(false);
  });

  it('returns false for scheduled type with null releaseAt', () => {
    const hb = makeHoldback({
      releaseType: HoldbackReleaseType.Scheduled,
      releaseAt: null,
    });
    expect(shouldAutoRelease(hb, 0, NOW)).toBe(false);
  });

  it('returns false for trigger type with null releaseTriggerPct', () => {
    const hb = makeHoldback({
      releaseType: HoldbackReleaseType.Trigger,
      releaseTriggerPct: null,
    });
    expect(shouldAutoRelease(hb, 99, NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateHoldbackQuantity
// ---------------------------------------------------------------------------

describe('validateHoldbackQuantity', () => {
  it('does not throw when requested equals available', () => {
    expect(() => validateHoldbackQuantity(100, 100)).not.toThrow();
  });

  it('does not throw when requested is below available', () => {
    expect(() => validateHoldbackQuantity(50, 100)).not.toThrow();
  });

  it('throws InsufficientInventoryError when requested exceeds available', () => {
    expect(() => validateHoldbackQuantity(101, 100)).toThrowError(
      InsufficientInventoryError,
    );
  });

  it('includes quantities in the error message', () => {
    let caught: Error | null = null;
    try {
      validateHoldbackQuantity(200, 50);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toContain('200');
    expect(caught?.message).toContain('50');
  });

  it('throws when available is zero', () => {
    expect(() => validateHoldbackQuantity(1, 0)).toThrowError(
      InsufficientInventoryError,
    );
  });
});

// ---------------------------------------------------------------------------
// calculateReleasedQty
// ---------------------------------------------------------------------------

describe('calculateReleasedQty', () => {
  it('returns full remaining quantity for full release (requestedRelease = 0)', () => {
    const hb = makeHoldback({ quantity: 100, quantityReleased: 0 });
    expect(calculateReleasedQty(hb, 0)).toBe(100);
  });

  it('returns full remaining after partial prior release', () => {
    const hb = makeHoldback({ quantity: 100, quantityReleased: 60 });
    expect(calculateReleasedQty(hb, 0)).toBe(40);
  });

  it('returns requested partial release', () => {
    const hb = makeHoldback({ quantity: 100, quantityReleased: 0 });
    expect(calculateReleasedQty(hb, 30)).toBe(30);
  });

  it('allows partial release leaving some still held', () => {
    const hb = makeHoldback({ quantity: 100, quantityReleased: 20 });
    // 80 still held, requesting to release 50
    expect(calculateReleasedQty(hb, 50)).toBe(50);
  });

  it('throws InvalidReleaseQuantityError when partial release exceeds remaining', () => {
    const hb = makeHoldback({ quantity: 100, quantityReleased: 80 });
    // Only 20 remain, trying to release 30
    expect(() => calculateReleasedQty(hb, 30)).toThrowError(
      InvalidReleaseQuantityError,
    );
  });

  it('allows exact match — release exactly what is remaining', () => {
    const hb = makeHoldback({ quantity: 100, quantityReleased: 70 });
    expect(calculateReleasedQty(hb, 30)).toBe(30);
  });

  it('returns 0 for full release when all already released', () => {
    const hb = makeHoldback({ quantity: 100, quantityReleased: 100 });
    expect(calculateReleasedQty(hb, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateSellThroughPct
// ---------------------------------------------------------------------------

describe('calculateSellThroughPct', () => {
  it('returns 0 when nothing sold', () => {
    expect(calculateSellThroughPct(1000, 0)).toBe(0);
  });

  it('returns 100 when fully sold', () => {
    expect(calculateSellThroughPct(1000, 1000)).toBe(100);
  });

  it('returns 50 when half sold', () => {
    expect(calculateSellThroughPct(1000, 500)).toBe(50);
  });

  it('returns 0 for zero total capacity', () => {
    expect(calculateSellThroughPct(0, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Combined scenario: event with multiple holdbacks
// ---------------------------------------------------------------------------

describe('combined scenario — event with multiple holdbacks', () => {
  it('correctly calculates available after multiple holdbacks are created', () => {
    // 1000 seat venue, 200 sold, 3 holdbacks: 100 VIP + 50 sponsor + 20 press
    const totalQty = 1000;
    const soldQty = 200;
    const existingHoldbacks = 100 + 50 + 20; // 170

    const available = calculateAvailableForHoldback(totalQty, soldQty, existingHoldbacks);
    expect(available).toBe(630); // 1000 - 200 - 170

    const publicVisible = calculateEffectiveAvailable(totalQty, soldQty, existingHoldbacks);
    expect(publicVisible).toBe(630);
  });

  it('trigger holdback fires when sell-through crosses threshold across the ticket base', () => {
    // 1000 tickets, 800 sold = 80% — trigger at 80% fires
    const sold = 800;
    const total = 1000;
    const pct = calculateSellThroughPct(total, sold);

    const hb = makeHoldback({
      releaseType: HoldbackReleaseType.Trigger,
      releaseTriggerPct: 80,
    });

    expect(shouldAutoRelease(hb, pct, NOW)).toBe(true);
  });

  it('trigger holdback does NOT fire at 79.9% sell-through', () => {
    const pct = calculateSellThroughPct(1000, 799);

    const hb = makeHoldback({
      releaseType: HoldbackReleaseType.Trigger,
      releaseTriggerPct: 80,
    });

    expect(shouldAutoRelease(hb, pct, NOW)).toBe(false);
  });

  it('after releasing 50 of 100 holdback, public availability increases', () => {
    // Before partial release: 1000 total, 200 sold, 100 still held
    const beforeRelease = calculateEffectiveAvailable(1000, 200, 100);
    expect(beforeRelease).toBe(700);

    // After partial release of 50 (still hold 50)
    const afterRelease = calculateEffectiveAvailable(1000, 200, 50);
    expect(afterRelease).toBe(750);
  });

  it('safety reserve holdback validated against current availability', () => {
    // 1000 total, 950 sold, 20 already held for safety — trying to add 50 more
    const available = calculateAvailableForHoldback(1000, 950, 20);
    expect(available).toBe(30); // only 30 tickets left

    expect(() => validateHoldbackQuantity(50, available)).toThrowError(
      InsufficientInventoryError,
    );
    expect(() => validateHoldbackQuantity(30, available)).not.toThrow();
  });
});
