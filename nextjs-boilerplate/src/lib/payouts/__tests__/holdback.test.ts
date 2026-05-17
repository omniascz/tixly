import { describe, it, expect } from 'vitest';
import {
  getEffectiveHoldback,
  computeHoldbackAmount,
  computeReleaseDate,
} from '../holdback';

describe('getEffectiveHoldback', () => {
  it('tier 1 default = 5 % / 90 dní', () => {
    expect(getEffectiveHoldback(1, null, null)).toEqual({ pctBps: 500, retentionDays: 90 });
  });

  it('tier 2 default = 3 % / 60 dní', () => {
    expect(getEffectiveHoldback(2, null, null)).toEqual({ pctBps: 300, retentionDays: 60 });
  });

  it('tier 3+ default = 0 %', () => {
    expect(getEffectiveHoldback(3, null, null)).toEqual({ pctBps: 0, retentionDays: 0 });
    expect(getEffectiveHoldback(4, null, null)).toEqual({ pctBps: 0, retentionDays: 0 });
  });

  it('override pct vyhrává nad tier default', () => {
    expect(getEffectiveHoldback(1, 200, null)).toEqual({ pctBps: 200, retentionDays: 90 });
  });

  it('override days vyhrává nad tier default', () => {
    expect(getEffectiveHoldback(1, null, 30)).toEqual({ pctBps: 500, retentionDays: 30 });
  });

  it('nevalidní tier padá na T1 defaults', () => {
    expect(getEffectiveHoldback(99 as never, null, null)).toEqual({ pctBps: 500, retentionDays: 90 });
  });
});

describe('computeHoldbackAmount', () => {
  it('5 % z 100 000 halířů = 5 000', () => {
    expect(computeHoldbackAmount(100_000, { pctBps: 500, retentionDays: 90 })).toBe(5_000);
  });

  it('0 % vrátí 0', () => {
    expect(computeHoldbackAmount(100_000, { pctBps: 0, retentionDays: 0 })).toBe(0);
  });

  it('zero gross vrátí 0', () => {
    expect(computeHoldbackAmount(0, { pctBps: 500, retentionDays: 90 })).toBe(0);
  });

  it('floor — žádné zaokrouhlení nahoru', () => {
    // 3 % z 333 halířů = 9.99 → 9
    expect(computeHoldbackAmount(333, { pctBps: 300, retentionDays: 60 })).toBe(9);
  });
});

describe('computeReleaseDate', () => {
  it('release_date = payout + retention_days', () => {
    const payout = new Date('2026-05-15T00:00:00Z');
    const release = computeReleaseDate({ pctBps: 500, retentionDays: 90 }, payout);
    expect(release.toISOString().slice(0, 10)).toBe('2026-08-13');
  });

  it('0 dní = stejný den', () => {
    const payout = new Date('2026-05-15T00:00:00Z');
    const release = computeReleaseDate({ pctBps: 0, retentionDays: 0 }, payout);
    expect(release.toISOString().slice(0, 10)).toBe('2026-05-15');
  });
});
