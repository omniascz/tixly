import { describe, it, expect, vi } from 'vitest';
import { findConnectedUsers, findUserClusters } from '../lib/graph-analytics.js';
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

describe('findConnectedUsers', () => {
  it('returns edges for direct neighbors', async () => {
    const deps = mockDeps(async () => [
      { other_user_id: 'u2', signal: 'shared_device' },
      { other_user_id: 'u3', signal: 'shared_card' },
    ]);
    const edges = await findConnectedUsers('u1', 1, deps);
    expect(edges).toHaveLength(2);
    expect(edges[0].fromUserId).toBe('u1');
    expect(edges.map((e) => e.toUserId).sort()).toEqual(['u2', 'u3']);
  });

  it('computes strength from signal types', async () => {
    const deps = mockDeps(async () => [
      { other_user_id: 'u2', signal: 'shared_device' },
      { other_user_id: 'u2', signal: 'shared_card' },
    ]);
    const edges = await findConnectedUsers('u1', 1, deps);
    // shared_device (0.35) + shared_card (0.45) = 0.80
    expect(edges).toHaveLength(1);
    expect(edges[0].strength).toBeCloseTo(0.80, 2);
    expect(edges[0].signals).toContain('shared_device');
    expect(edges[0].signals).toContain('shared_card');
  });

  it('returns empty array for isolated user', async () => {
    const deps = mockDeps(async () => []);
    const edges = await findConnectedUsers('u1', 2, deps);
    expect(edges).toEqual([]);
  });

  it('caps strength at 1.0', async () => {
    const deps = mockDeps(async () => [
      { other_user_id: 'u2', signal: 'shared_device' },
      { other_user_id: 'u2', signal: 'shared_card' },
      { other_user_id: 'u2', signal: 'shared_phone' },
      { other_user_id: 'u2', signal: 'shared_address' },
    ]);
    const edges = await findConnectedUsers('u1', 1, deps);
    // 0.35 + 0.45 + 0.15 + 0.15 = 1.10 → capped to 1.0
    expect(edges[0].strength).toBe(1.0);
  });

  it('traverses multiple hops', async () => {
    let callCount = 0;
    const deps = mockDeps(async (_sql, params) => {
      callCount++;
      const userId = params?.[0] as string;
      if (userId === 'u1') return [{ other_user_id: 'u2', signal: 'shared_device' }];
      if (userId === 'u2') return [{ other_user_id: 'u3', signal: 'shared_card' }];
      return [];
    });
    const edges = await findConnectedUsers('u1', 3, deps);
    expect(edges).toHaveLength(2);
    expect(edges.some((e) => e.fromUserId === 'u1' && e.toUserId === 'u2')).toBe(true);
    expect(edges.some((e) => e.fromUserId === 'u2' && e.toUserId === 'u3')).toBe(true);
  });

  it('does not revisit already-visited nodes', async () => {
    // u1 → u2, u2 → u1 (cycle) — should not loop
    const deps = mockDeps(async (_sql, params) => {
      const userId = params?.[0] as string;
      if (userId === 'u1') return [{ other_user_id: 'u2', signal: 'shared_device' }];
      if (userId === 'u2') return [{ other_user_id: 'u1', signal: 'shared_device' }];
      return [];
    });
    const edges = await findConnectedUsers('u1', 5, deps);
    // u1→u2 edge and u2→u1 back-edge are both recorded, but BFS doesn't loop
    expect(edges.filter((e) => e.fromUserId === 'u1').length).toBe(1);
    expect(edges.filter((e) => e.fromUserId === 'u2').length).toBe(1);
  });
});

describe('findUserClusters', () => {
  it('returns clusters of 3+ users sharing device fingerprint', async () => {
    const deps = mockDeps(async () => [
      {
        fingerprint_hash: 'fp_abc',
        user_ids: ['u1', 'u2', 'u3'],
        user_count: 3,
      },
    ]);
    const clusters = await findUserClusters('promoter_1', deps);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].userIds).toHaveLength(3);
    expect(clusters[0].flags).toContain('shared_device');
    expect(clusters[0].cohesion).toBe(3);
  });

  it('flags potential_ring for 5+ users', async () => {
    const deps = mockDeps(async () => [
      {
        fingerprint_hash: 'fp_xyz',
        user_ids: ['u1', 'u2', 'u3', 'u4', 'u5'],
        user_count: 5,
      },
    ]);
    const clusters = await findUserClusters('promoter_1', deps);
    expect(clusters[0].flags).toContain('potential_ring');
  });

  it('does not flag potential_ring for 3-4 users', async () => {
    const deps = mockDeps(async () => [
      {
        fingerprint_hash: 'fp_small',
        user_ids: ['u1', 'u2', 'u3', 'u4'],
        user_count: 4,
      },
    ]);
    const clusters = await findUserClusters('promoter_1', deps);
    expect(clusters[0].flags).not.toContain('potential_ring');
  });

  it('returns empty array when no clusters found', async () => {
    const deps = mockDeps(async () => []);
    const clusters = await findUserClusters('promoter_1', deps);
    expect(clusters).toEqual([]);
  });

  it('returns multiple clusters', async () => {
    const deps = mockDeps(async () => [
      { fingerprint_hash: 'fp1', user_ids: ['u1', 'u2', 'u3'], user_count: 3 },
      { fingerprint_hash: 'fp2', user_ids: ['u4', 'u5', 'u6', 'u7', 'u8'], user_count: 5 },
    ]);
    const clusters = await findUserClusters('promoter_1', deps);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].id).toBe('fp1');
    expect(clusters[1].id).toBe('fp2');
    expect(clusters[1].flags).toContain('potential_ring');
  });
});
