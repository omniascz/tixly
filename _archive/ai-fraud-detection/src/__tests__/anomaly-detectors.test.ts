import { describe, it, expect, vi } from 'vitest';
import {
  detectVelocitySpike,
  detectSharedDeviceCluster,
  detectPriceOutlier,
  detectTimeOutlier,
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

describe('detectVelocitySpike', () => {
  it('flags >10 orders in 1h as critical', async () => {
    const deps = mockDeps(async () => [{ cnt: 12, ids: ['o1', 'o2'] }]);
    const r = await detectVelocitySpike('user', 'u1', deps);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('critical');
    expect(r!.type).toBe('velocity_spike');
  });

  it('flags 4 orders as medium', async () => {
    const deps = mockDeps(async () => [{ cnt: 4, ids: ['o1'] }]);
    const r = await detectVelocitySpike('user', 'u1', deps);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('medium');
  });

  it('returns null for normal traffic', async () => {
    const deps = mockDeps(async () => [{ cnt: 2, ids: [] }]);
    const r = await detectVelocitySpike('user', 'u1', deps);
    expect(r).toBeNull();
  });
});

describe('detectSharedDeviceCluster', () => {
  it('flags 6 users as critical', async () => {
    const deps = mockDeps(async () => [{ user_count: 6, user_ids: ['u1', 'u2', 'u3'] }]);
    const r = await detectSharedDeviceCluster('fp', deps);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('critical');
  });

  it('returns null for 1 user', async () => {
    const deps = mockDeps(async () => [{ user_count: 1, user_ids: ['u1'] }]);
    const r = await detectSharedDeviceCluster('fp', deps);
    expect(r).toBeNull();
  });
});

describe('detectPriceOutlier', () => {
  it('flags order 5σ above user mean as critical', async () => {
    let call = 0;
    const deps = mockDeps(async () => {
      call++;
      if (call === 1) return [{ user_id: 'u1', total_hellers: 1_000_000 }];
      return [{ avg: '100000', stddev: '10000', cnt: 20 }];
    });
    const r = await detectPriceOutlier('order1', deps);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('critical');
  });

  it('returns null when insufficient history', async () => {
    let call = 0;
    const deps = mockDeps(async () => {
      call++;
      if (call === 1) return [{ user_id: 'u1', total_hellers: 999999 }];
      return [{ avg: '100', stddev: '10', cnt: 2 }];
    });
    const r = await detectPriceOutlier('order1', deps);
    expect(r).toBeNull();
  });
});

describe('detectTimeOutlier', () => {
  it('flags 4 AM purchase as medium', async () => {
    const deps = mockDeps(async () => [{ hour_local: 4 }]);
    const r = await detectTimeOutlier('order1', deps);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('medium');
  });

  it('returns null for 14:00 purchase', async () => {
    const deps = mockDeps(async () => [{ hour_local: 14 }]);
    const r = await detectTimeOutlier('order1', deps);
    expect(r).toBeNull();
  });
});
