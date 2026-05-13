import { describe, it, expect, vi } from 'vitest';
import {
  detectAmountOutlier,
  detectDuplicateCard,
  detectCircularRefund,
  detectRapidAccountCreation,
  detectGeographicJump,
  detectVelocitySpike,
} from '../lib/anomaly-detectors.js';
import type { ServiceDeps } from '../lib/service-container.js';

function mockDeps(queryImpl: (sql: string, params?: unknown[]) => Promise<unknown[]>): ServiceDeps {
  return {
    db: {
      query: vi.fn(queryImpl) as ServiceDeps['db']['query'],
      execute: vi.fn().mockResolvedValue(undefined),
    },
    kafka: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

// ---------------------------------------------------------------------------
// detectAmountOutlier
// ---------------------------------------------------------------------------
describe('detectAmountOutlier', () => {
  it('flags 4σ+ order as high', async () => {
    let call = 0;
    const deps = mockDeps(async () => {
      call++;
      if (call === 1) return [{ event_id: 'e1', total_hellers: 500_000 }];
      return [{ avg: '100000', stddev: '50000', cnt: 25 }]; // z = (500k-100k)/50k = 8
    });
    const r = await detectAmountOutlier('o1', deps);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('high');
    expect(r!.type).toBe('amount_outlier');
  });

  it('flags 2.5σ order as medium', async () => {
    let call = 0;
    const deps = mockDeps(async () => {
      call++;
      if (call === 1) return [{ event_id: 'e1', total_hellers: 225_000 }];
      return [{ avg: '100000', stddev: '50000', cnt: 25 }]; // z = 2.5
    });
    const r = await detectAmountOutlier('o1', deps);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('medium');
  });

  it('returns null when insufficient event orders (<20)', async () => {
    let call = 0;
    const deps = mockDeps(async () => {
      call++;
      if (call === 1) return [{ event_id: 'e1', total_hellers: 999999 }];
      return [{ avg: '100', stddev: '10', cnt: 5 }];
    });
    expect(await detectAmountOutlier('o1', deps)).toBeNull();
  });

  it('returns null when order has no event_id', async () => {
    const deps = mockDeps(async () => [{ event_id: null, total_hellers: 100 }]);
    expect(await detectAmountOutlier('o1', deps)).toBeNull();
  });

  it('returns null when order not found', async () => {
    const deps = mockDeps(async () => []);
    expect(await detectAmountOutlier('nonexistent', deps)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectDuplicateCard
// ---------------------------------------------------------------------------
describe('detectDuplicateCard', () => {
  it('flags card used by 5+ users as critical', async () => {
    const deps = mockDeps(async () => [{ user_count: 5, user_ids: ['u1', 'u2', 'u3', 'u4', 'u5'] }]);
    const r = await detectDuplicateCard('card_abc', deps);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('critical');
    expect(r!.confidence).toBe(95);
  });

  it('flags card used by 3 users as high', async () => {
    const deps = mockDeps(async () => [{ user_count: 3, user_ids: ['u1', 'u2', 'u3'] }]);
    const r = await detectDuplicateCard('card_abc', deps);
    expect(r!.severity).toBe('high');
  });

  it('flags card used by 2 users as medium', async () => {
    const deps = mockDeps(async () => [{ user_count: 2, user_ids: ['u1', 'u2'] }]);
    const r = await detectDuplicateCard('card_abc', deps);
    expect(r!.severity).toBe('medium');
  });

  it('returns null for single-user card', async () => {
    const deps = mockDeps(async () => [{ user_count: 1, user_ids: ['u1'] }]);
    expect(await detectDuplicateCard('card_abc', deps)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectCircularRefund
// ---------------------------------------------------------------------------
describe('detectCircularRefund', () => {
  it('flags circular refund with 2+ counterparties as critical', async () => {
    const deps = mockDeps(async () => [
      { counterparty: 'u2', cycles: 3 },
      { counterparty: 'u3', cycles: 2 },
    ]);
    const r = await detectCircularRefund('u1', deps);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('critical');
    expect(r!.type).toBe('circular_refund');
  });

  it('flags single counterparty as high', async () => {
    const deps = mockDeps(async () => [{ counterparty: 'u2', cycles: 2 }]);
    const r = await detectCircularRefund('u1', deps);
    expect(r!.severity).toBe('high');
  });

  it('returns null when no circular patterns', async () => {
    const deps = mockDeps(async () => []);
    expect(await detectCircularRefund('u1', deps)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectRapidAccountCreation
// ---------------------------------------------------------------------------
describe('detectRapidAccountCreation', () => {
  it('flags 11+ accounts from same IP as critical', async () => {
    const deps = mockDeps(async () => [{ cnt: 11, user_ids: ['u1'] }]);
    const r = await detectRapidAccountCreation('1.2.3.4', deps);
    expect(r!.severity).toBe('critical');
    expect(r!.confidence).toBe(95);
  });

  it('flags 6 accounts as high', async () => {
    const deps = mockDeps(async () => [{ cnt: 6, user_ids: ['u1'] }]);
    const r = await detectRapidAccountCreation('1.2.3.4', deps);
    expect(r!.severity).toBe('high');
  });

  it('flags 4 accounts as medium', async () => {
    const deps = mockDeps(async () => [{ cnt: 4, user_ids: ['u1'] }]);
    const r = await detectRapidAccountCreation('1.2.3.4', deps);
    expect(r!.severity).toBe('medium');
  });

  it('returns null for 3 or fewer accounts', async () => {
    const deps = mockDeps(async () => [{ cnt: 3, user_ids: ['u1'] }]);
    expect(await detectRapidAccountCreation('1.2.3.4', deps)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectGeographicJump
// ---------------------------------------------------------------------------
describe('detectGeographicJump', () => {
  it('flags country switch within 30 min as high', async () => {
    const deps = mockDeps(async () => [
      {
        country_code: 'DE',
        created_at: '2026-04-11T10:15:00Z',
        prev_country: 'CZ',
        prev_at: '2026-04-11T10:00:00Z',
        gap_seconds: '900', // 15 min
      },
    ]);
    const r = await detectGeographicJump('u1', deps);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('high');
    expect(r!.type).toBe('geographic_jump');
  });

  it('returns null when same country', async () => {
    const deps = mockDeps(async () => [
      {
        country_code: 'CZ',
        created_at: '2026-04-11T10:15:00Z',
        prev_country: 'CZ',
        prev_at: '2026-04-11T10:00:00Z',
        gap_seconds: '900',
      },
    ]);
    expect(await detectGeographicJump('u1', deps)).toBeNull();
  });

  it('returns null when gap > 30 min', async () => {
    const deps = mockDeps(async () => [
      {
        country_code: 'DE',
        created_at: '2026-04-11T11:00:00Z',
        prev_country: 'CZ',
        prev_at: '2026-04-11T10:00:00Z',
        gap_seconds: '3600', // 60 min
      },
    ]);
    expect(await detectGeographicJump('u1', deps)).toBeNull();
  });

  it('returns null when no prev_country', async () => {
    const deps = mockDeps(async () => [
      {
        country_code: 'CZ',
        created_at: '2026-04-11T10:00:00Z',
        prev_country: null,
        prev_at: null,
        gap_seconds: null,
      },
    ]);
    expect(await detectGeographicJump('u1', deps)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectVelocitySpike — additional edge cases
// ---------------------------------------------------------------------------
describe('detectVelocitySpike — edge cases', () => {
  it('flags 6 orders as high', async () => {
    const deps = mockDeps(async () => [{ cnt: 6, ids: ['o1'] }]);
    const r = await detectVelocitySpike('user', 'u1', deps);
    expect(r!.severity).toBe('high');
    expect(r!.confidence).toBe(80);
  });

  it('returns null for exactly 3 orders', async () => {
    const deps = mockDeps(async () => [{ cnt: 3, ids: [] }]);
    expect(await detectVelocitySpike('user', 'u1', deps)).toBeNull();
  });
});
