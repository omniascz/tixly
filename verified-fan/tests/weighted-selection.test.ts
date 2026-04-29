import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSelection, register } from '../src/services/verified-fan.service';
import { AlreadyRegisteredError } from '../src/types/verified-fan.types';

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
});

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    query: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(makeDb())),
    ...overrides,
  };
}

function makeDeps(dbOverrides = {}) {
  return {
    db: makeDb(dbOverrides),
    redis: { setNx: vi.fn().mockResolvedValue(true) },
    kafka: { send: vi.fn().mockResolvedValue(undefined) },
    email: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

const NOW = new Date('2026-06-01T10:00:00Z');
const REG_OPEN = new Date('2026-05-01T00:00:00Z');
const REG_CLOSE = new Date('2026-06-30T23:59:59Z');

// ---------------------------------------------------------------------------
// runSelection() with 'weighted' method
// ---------------------------------------------------------------------------

describe('runSelection() — weighted method', () => {
  const WEIGHTED_CONFIG = {
    slots: 2,
    selection_method: 'weighted' as const,
    link_expires_after_hours: 48,
    presale_ticket_type_id: 'tt_presale',
  };

  it('uses weighted algorithm to select top fans', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([WEIGHTED_CONFIG])   // config
      .mockResolvedValueOnce([{ total: 3 }]);      // count

    deps.db.transaction = vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const tx = makeDb();
      // First query: load candidates
      tx.query = vi.fn()
        .mockResolvedValueOnce([
          { id: 'reg_1', user_id: 'u1', registered_at: REG_OPEN, loyalty_years: 5, past_purchases: 10, identity_verified: true, local_fan: true, social_followers: 5000 },
          { id: 'reg_2', user_id: 'u2', registered_at: REG_OPEN, loyalty_years: 0, past_purchases: 0, identity_verified: false, local_fan: false, social_followers: 0 },
          { id: 'reg_3', user_id: 'u3', registered_at: REG_OPEN, loyalty_years: 3, past_purchases: 5, identity_verified: true, local_fan: false, social_followers: 2000 },
        ])
        .mockResolvedValueOnce([{ registration_opens_at: REG_OPEN }]); // config for eventStart
      return fn(tx);
    });

    const result = await runSelection(deps, 'evt_001', NOW);

    expect(result.selectedCount).toBe(2);
    expect(result.method).toBe('weighted');
  });

  it('handles zero candidates', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([WEIGHTED_CONFIG])
      .mockResolvedValueOnce([{ total: 0 }]);

    deps.db.transaction = vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const tx = makeDb();
      tx.query = vi.fn()
        .mockResolvedValueOnce([])    // no candidates
        .mockResolvedValueOnce([{ registration_opens_at: REG_OPEN }]);
      return fn(tx);
    });

    const result = await runSelection(deps, 'evt_001', NOW);
    expect(result.selectedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// register() — identity anti-abuse
// ---------------------------------------------------------------------------

describe('register() — identity verification anti-abuse', () => {
  const CONFIG = {
    registration_opens_at: REG_OPEN,
    registration_closes_at: REG_CLOSE,
    event_id: 'evt_001',
  };

  it('rejects unverified user when identity adapter is wired', async () => {
    const deps = makeDeps();
    (deps as any).identity = {
      getStatus: vi.fn().mockResolvedValue({ verified: false }),
    };
    deps.db.query = vi.fn().mockResolvedValueOnce([CONFIG]);

    await expect(register(deps, 'user_1', 'evt_001', NOW))
      .rejects.toThrow(AlreadyRegisteredError);
  });

  it('rejects when same identity hash already registered under different user', async () => {
    const deps = makeDeps();
    (deps as any).identity = {
      getStatus: vi.fn().mockResolvedValue({ verified: true, identityHash: 'hash_abc' }),
    };
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([CONFIG])                              // config
      .mockResolvedValueOnce([{ user_id: 'user_other' }]);          // duplicate identity

    await expect(register(deps, 'user_1', 'evt_001', NOW))
      .rejects.toThrow(AlreadyRegisteredError);
  });

  it('allows registration when identity is verified and no duplicate', async () => {
    const deps = makeDeps();
    (deps as any).identity = {
      getStatus: vi.fn().mockResolvedValue({ verified: true, identityHash: 'hash_unique' }),
    };
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([CONFIG])                              // config
      .mockResolvedValueOnce([])                                    // no duplicate identity
      .mockResolvedValueOnce([{ id: 'reg_1', status: 'pending', registered_at: NOW }]); // INSERT

    const result = await register(deps, 'user_1', 'evt_001', NOW);
    expect(result.status).toBe('pending');
  });

  it('skips identity check when adapter is not provided', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([CONFIG])
      .mockResolvedValueOnce([{ id: 'reg_1', status: 'pending', registered_at: NOW }]);

    const result = await register(deps, 'user_1', 'evt_001', NOW);
    expect(result.status).toBe('pending');
  });
});
