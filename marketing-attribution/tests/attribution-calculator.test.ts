import { describe, it, expect } from 'vitest';
import { calculateAttribution } from '../src/lib/attribution-calculator';
import type { TouchPoint } from '../src/types/attribution.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextId = 1;

function makeTouchPoint(
  overrides: Partial<TouchPoint> & { createdAt: Date },
): TouchPoint {
  const id = `tp-${String(_nextId++).padStart(3, '0')}`;
  return {
    id,
    sessionId: 'session-test',
    userId: null,
    eventId: null,
    utmParams: null,
    channel: 'direct',
    referrer: null,
    ...overrides,
  };
}

function t(isoOffset: string): Date {
  return new Date(`2026-04-05T${isoOffset}Z`);
}

// ---------------------------------------------------------------------------
// first_click
// ---------------------------------------------------------------------------

describe('calculateAttribution — first_click', () => {
  it('returns empty array for empty input', () => {
    expect(calculateAttribution([], 'first_click')).toEqual([]);
  });

  it('assigns 100% credit to the single touch point', () => {
    const tp = makeTouchPoint({ createdAt: t('10:00:00'), channel: 'google_ads' });
    const result = calculateAttribution([tp], 'first_click');
    expect(result).toHaveLength(1);
    expect(result[0]!.touchPointId).toBe(tp.id);
    expect(result[0]!.credit).toBe(1);
    expect(result[0]!.channel).toBe('google_ads');
  });

  it('assigns all credit to the earliest touch point (out-of-order input)', () => {
    const second = makeTouchPoint({ createdAt: t('11:00:00'), channel: 'facebook' });
    const first = makeTouchPoint({ createdAt: t('09:00:00'), channel: 'email' });
    const third = makeTouchPoint({ createdAt: t('13:00:00'), channel: 'direct' });

    const result = calculateAttribution([second, first, third], 'first_click');
    expect(result).toHaveLength(1);
    expect(result[0]!.touchPointId).toBe(first.id);
    expect(result[0]!.credit).toBe(1);
    expect(result[0]!.channel).toBe('email');
  });

  it('does not mutate the input array', () => {
    const tps = [
      makeTouchPoint({ createdAt: t('12:00:00'), channel: 'google_ads' }),
      makeTouchPoint({ createdAt: t('08:00:00'), channel: 'facebook' }),
    ];
    const originalOrder = tps.map((tp) => tp.id);
    calculateAttribution(tps, 'first_click');
    expect(tps.map((tp) => tp.id)).toEqual(originalOrder);
  });
});

// ---------------------------------------------------------------------------
// last_click
// ---------------------------------------------------------------------------

describe('calculateAttribution — last_click', () => {
  it('returns empty array for empty input', () => {
    expect(calculateAttribution([], 'last_click')).toEqual([]);
  });

  it('assigns 100% credit to the single touch point', () => {
    const tp = makeTouchPoint({ createdAt: t('10:00:00'), channel: 'facebook' });
    const result = calculateAttribution([tp], 'last_click');
    expect(result[0]!.credit).toBe(1);
    expect(result[0]!.touchPointId).toBe(tp.id);
  });

  it('assigns all credit to the latest touch point (out-of-order input)', () => {
    const first = makeTouchPoint({ createdAt: t('08:00:00'), channel: 'email' });
    const last = makeTouchPoint({ createdAt: t('14:00:00'), channel: 'google_ads' });
    const middle = makeTouchPoint({ createdAt: t('11:00:00'), channel: 'facebook' });

    const result = calculateAttribution([first, last, middle], 'last_click');
    expect(result).toHaveLength(1);
    expect(result[0]!.touchPointId).toBe(last.id);
    expect(result[0]!.credit).toBe(1);
    expect(result[0]!.channel).toBe('google_ads');
  });

  it('does not mutate the input array', () => {
    const tps = [
      makeTouchPoint({ createdAt: t('12:00:00'), channel: 'direct' }),
      makeTouchPoint({ createdAt: t('09:00:00'), channel: 'referral' }),
    ];
    const originalOrder = tps.map((tp) => tp.id);
    calculateAttribution(tps, 'last_click');
    expect(tps.map((tp) => tp.id)).toEqual(originalOrder);
  });
});

// ---------------------------------------------------------------------------
// linear
// ---------------------------------------------------------------------------

describe('calculateAttribution — linear', () => {
  it('returns empty array for empty input', () => {
    expect(calculateAttribution([], 'linear')).toEqual([]);
  });

  it('assigns credit 1 to a single touch point', () => {
    const tp = makeTouchPoint({ createdAt: t('10:00:00'), channel: 'direct' });
    const result = calculateAttribution([tp], 'linear');
    expect(result[0]!.credit).toBe(1);
  });

  it('divides credit equally between two touch points (0.5 each)', () => {
    const tp1 = makeTouchPoint({ createdAt: t('09:00:00'), channel: 'email' });
    const tp2 = makeTouchPoint({ createdAt: t('11:00:00'), channel: 'facebook' });
    const result = calculateAttribution([tp1, tp2], 'linear');
    expect(result).toHaveLength(2);
    expect(result[0]!.credit).toBe(0.5);
    expect(result[1]!.credit).toBe(0.5);
  });

  it('divides credit equally between three touch points (0.3333 rounded)', () => {
    const tps = [
      makeTouchPoint({ createdAt: t('09:00:00'), channel: 'email' }),
      makeTouchPoint({ createdAt: t('10:00:00'), channel: 'facebook' }),
      makeTouchPoint({ createdAt: t('11:00:00'), channel: 'google_ads' }),
    ];
    const result = calculateAttribution(tps, 'linear');
    expect(result).toHaveLength(3);
    expect(result[0]!.credit).toBe(0.3333);
    expect(result[1]!.credit).toBe(0.3333);
    // Last absorbs rounding residual
    expect(result[2]!.credit).toBe(0.3334);
  });

  it('sum of linear credits is exactly 1.0', () => {
    const tps = Array.from({ length: 7 }, (_, i) =>
      makeTouchPoint({ createdAt: new Date(2026, 3, 5, i), channel: 'direct' }),
    );
    const result = calculateAttribution(tps, 'linear');
    const sum = result.reduce((acc, r) => acc + r.credit, 0);
    expect(sum).toBeCloseTo(1, 10);
    // Exact float check via scaled integer comparison
    const scaled = result.reduce((acc, r) => acc + Math.round(r.credit * 10000), 0);
    expect(scaled).toBe(10000);
  });

  it('credits are ordered chronologically (earliest first)', () => {
    const late = makeTouchPoint({ createdAt: t('15:00:00'), channel: 'direct' });
    const early = makeTouchPoint({ createdAt: t('08:00:00'), channel: 'email' });
    const result = calculateAttribution([late, early], 'linear');
    expect(result[0]!.touchPointId).toBe(early.id);
    expect(result[1]!.touchPointId).toBe(late.id);
  });

  it('each credit value is rounded to at most 4 decimal places', () => {
    const tps = Array.from({ length: 3 }, (_, i) =>
      makeTouchPoint({ createdAt: new Date(2026, 3, 5, i), channel: 'direct' }),
    );
    const result = calculateAttribution(tps, 'linear');
    for (const r of result) {
      const decimalStr = r.credit.toString().split('.')[1] ?? '';
      expect(decimalStr.length).toBeLessThanOrEqual(4);
    }
  });

  it('sum is exactly 1.0 for 10 touch points', () => {
    const tps = Array.from({ length: 10 }, (_, i) =>
      makeTouchPoint({ createdAt: new Date(2026, 3, 5, i), channel: 'direct' }),
    );
    const result = calculateAttribution(tps, 'linear');
    const scaled = result.reduce((acc, r) => acc + Math.round(r.credit * 10000), 0);
    expect(scaled).toBe(10000);
  });
});
