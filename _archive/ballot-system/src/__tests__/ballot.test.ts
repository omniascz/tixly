import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createBallot,
  openRegistration,
  closeRegistration,
  registerForBallot,
  conductDraw,
  getMyBallotStatus,
  forfeitSlot,
} from '../services/ballot.service.js';
import type {
  Ballot,
  BallotEntry,
  BallotInput,
  DbAdapter,
  ServiceDeps,
} from '../types/ballot.types.js';
import { BallotError } from '../types/ballot.types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBallot(overrides: Partial<Ballot> = {}): Ballot {
  return {
    id: 'ballot-1',
    eventId: 'event-1',
    organizerId: 'org-1',
    name: 'Test Ballot',
    totalSlots: 2,
    registrationOpensAt: new Date('2026-04-01T10:00:00Z'),
    registrationClosesAt: new Date('2026-04-10T10:00:00Z'),
    purchaseWindowHours: 48,
    status: 'draft',
    drawnAt: null,
    createdAt: new Date('2026-04-01T09:00:00Z'),
    ...overrides,
  };
}

function makeEntry(overrides: Partial<BallotEntry> = {}): BallotEntry {
  return {
    id: 'entry-1',
    ballotId: 'ballot-1',
    userId: 'user-1',
    status: 'registered',
    rank: null,
    purchaseDeadlineAt: null,
    registeredAt: new Date('2026-04-05T10:00:00Z'),
    updatedAt: new Date('2026-04-05T10:00:00Z'),
    ...overrides,
  };
}

function makeInput(overrides: Partial<BallotInput> = {}): BallotInput {
  return {
    eventId: 'event-1',
    organizerId: 'org-1',
    name: 'Test Ballot',
    totalSlots: 2,
    registrationOpensAt: new Date('2026-04-01T10:00:00Z'),
    registrationClosesAt: new Date('2026-04-10T10:00:00Z'),
    ...overrides,
  };
}

function makeDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  const db: DbAdapter = {
    query: vi.fn(async () => []),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(async (fn) => fn(db)),
    ...overrides,
  };
  return db;
}

function makeDeps(dbOverrides: Partial<DbAdapter> = {}): ServiceDeps {
  return { db: makeDb(dbOverrides) };
}

// ── createBallot ─────────────────────────────────────────────────────────────

describe('createBallot', () => {
  it('inserts a ballot with status draft and returns it', async () => {
    const ballot = makeBallot();
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([ballot]),
    });
    const deps = { db };

    const result = await createBallot(makeInput(), deps);

    expect(db.execute).toHaveBeenCalledOnce();
    const sql = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("'draft'");
    expect(result.status).toBe('draft');
    expect(result.id).toBe('ballot-1');
  });

  it('uses default purchaseWindowHours of 48 when not provided', async () => {
    const ballot = makeBallot({ purchaseWindowHours: 48 });
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([ballot]),
    });

    await createBallot(makeInput(), { db });

    const params = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as unknown[];
    expect(params).toContain(48);
  });

  it('uses provided purchaseWindowHours when given', async () => {
    const ballot = makeBallot({ purchaseWindowHours: 24 });
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([ballot]),
    });

    await createBallot(makeInput({ purchaseWindowHours: 24 }), { db });

    const params = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as unknown[];
    expect(params).toContain(24);
  });

  it('throws BALLOT_NOT_FOUND if query returns empty after insert', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([]),
    });

    await expect(createBallot(makeInput(), { db })).rejects.toThrow(BallotError);
    await expect(createBallot(makeInput(), { db: makeDb({ query: vi.fn().mockResolvedValueOnce([]) }) }))
      .rejects.toMatchObject({ code: 'BALLOT_NOT_FOUND' });
  });
});

// ── openRegistration ─────────────────────────────────────────────────────────

describe('openRegistration', () => {
  it('transitions ballot from draft to open', async () => {
    const draft = makeBallot({ status: 'draft' });
    const opened = makeBallot({ status: 'open' });
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([draft])
        .mockResolvedValueOnce([opened]),
    });

    const result = await openRegistration('ballot-1', 'org-1', { db });

    expect(db.execute).toHaveBeenCalledOnce();
    const sql = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("'open'");
    expect(result.status).toBe('open');
  });

  it('throws BALLOT_NOT_FOUND when ballot does not exist', async () => {
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([]) });

    await expect(openRegistration('missing', 'org-1', { db })).rejects.toMatchObject({
      code: 'BALLOT_NOT_FOUND',
    });
  });

  it('throws REGISTRATION_NOT_OPEN when ballot is not in draft status', async () => {
    const open = makeBallot({ status: 'open' });
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([open]) });

    await expect(openRegistration('ballot-1', 'org-1', { db })).rejects.toMatchObject({
      code: 'REGISTRATION_NOT_OPEN',
    });
  });
});

// ── registerForBallot ─────────────────────────────────────────────────────────

describe('registerForBallot', () => {
  it('successfully registers a user for an open ballot', async () => {
    const openBallot = makeBallot({ status: 'open' });
    const entry = makeEntry();
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([openBallot])  // ballot lookup
        .mockResolvedValueOnce([])            // existing entry lookup
        .mockResolvedValueOnce([entry]),      // entry after insert
    });

    const result = await registerForBallot('ballot-1', 'user-1', { db });

    expect(db.execute).toHaveBeenCalledOnce();
    expect(result.status).toBe('registered');
    expect(result.userId).toBe('user-1');
  });

  it('throws ALREADY_REGISTERED for duplicate registration', async () => {
    const openBallot = makeBallot({ status: 'open' });
    const existing = makeEntry();
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([openBallot])
        .mockResolvedValueOnce([existing]),
    });

    await expect(registerForBallot('ballot-1', 'user-1', { db })).rejects.toMatchObject({
      code: 'ALREADY_REGISTERED',
    });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('throws REGISTRATION_NOT_OPEN when ballot is not open', async () => {
    const closedBallot = makeBallot({ status: 'closed' });
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([closedBallot]) });

    await expect(registerForBallot('ballot-1', 'user-1', { db })).rejects.toMatchObject({
      code: 'REGISTRATION_NOT_OPEN',
    });
  });

  it('throws BALLOT_NOT_FOUND when ballot does not exist', async () => {
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([]) });

    await expect(registerForBallot('missing', 'user-1', { db })).rejects.toMatchObject({
      code: 'BALLOT_NOT_FOUND',
    });
  });
});

// ── conductDraw ───────────────────────────────────────────────────────────────

describe('conductDraw', () => {
  it('selects correct number of winners and waitlists the rest', async () => {
    const ballot = makeBallot({ status: 'closed', totalSlots: 2 });
    const entries = [
      makeEntry({ id: 'e1', userId: 'u1' }),
      makeEntry({ id: 'e2', userId: 'u2' }),
      makeEntry({ id: 'e3', userId: 'u3' }),
      makeEntry({ id: 'e4', userId: 'u4' }),
    ];

    const innerDb = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([ballot])
        .mockResolvedValueOnce(entries),
    });

    const result = await conductDraw('ballot-1', 'org-1', { db: innerDb });

    expect(result.selectedCount).toBe(2);
    expect(result.waitlistedCount).toBe(2);
    expect(result.selected).toHaveLength(2);
  });

  it('assigns ranks 1-based to selected entries', async () => {
    const ballot = makeBallot({ status: 'closed', totalSlots: 2 });
    const entries = [
      makeEntry({ id: 'e1', userId: 'u1' }),
      makeEntry({ id: 'e2', userId: 'u2' }),
    ];

    const innerDb = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([ballot])
        .mockResolvedValueOnce(entries),
    });

    const result = await conductDraw('ballot-1', 'org-1', { db: innerDb });

    const ranks = result.selected.map((s) => s.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2]);
  });

  it('all entries get ranks after draw', async () => {
    const ballot = makeBallot({ status: 'closed', totalSlots: 1 });
    const entries = [
      makeEntry({ id: 'e1', userId: 'u1' }),
      makeEntry({ id: 'e2', userId: 'u2' }),
      makeEntry({ id: 'e3', userId: 'u3' }),
    ];

    const executeRanks: number[] = [];
    const innerDb = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([ballot])
        .mockResolvedValueOnce(entries),
      execute: vi.fn(async (_sql: string, params?: unknown[]) => {
        if (params && typeof params[0] === 'number') {
          executeRanks.push(params[0] as number);
        }
      }),
    });

    await conductDraw('ballot-1', 'org-1', { db: innerDb });

    // 3 entries should have ranks assigned: 1 selected (rank 1), 2 waitlisted (rank 2, 3)
    expect(executeRanks.length).toBe(3);
  });

  it('throws BALLOT_NOT_CLOSED when ballot is still open', async () => {
    const ballot = makeBallot({ status: 'open' });
    const innerDb = makeDb({
      query: vi.fn().mockResolvedValueOnce([ballot]),
    });

    await expect(conductDraw('ballot-1', 'org-1', { db: innerDb })).rejects.toMatchObject({
      code: 'BALLOT_NOT_CLOSED',
    });
  });

  it('throws BALLOT_ALREADY_DRAWN on second draw attempt', async () => {
    const drawnBallot = makeBallot({ status: 'drawn', drawnAt: new Date() });
    const innerDb = makeDb({
      query: vi.fn().mockResolvedValueOnce([drawnBallot]),
    });

    await expect(conductDraw('ballot-1', 'org-1', { db: innerDb })).rejects.toMatchObject({
      code: 'BALLOT_ALREADY_DRAWN',
    });
  });

  it('throws BALLOT_NOT_FOUND when ballot does not exist', async () => {
    const innerDb = makeDb({
      query: vi.fn().mockResolvedValueOnce([]),
    });

    await expect(conductDraw('missing', 'org-1', { db: innerDb })).rejects.toMatchObject({
      code: 'BALLOT_NOT_FOUND',
    });
  });

  it('sets purchaseDeadlineAt for selected entries based on purchaseWindowHours', async () => {
    const ballot = makeBallot({ status: 'closed', totalSlots: 1, purchaseWindowHours: 24 });
    const entries = [makeEntry({ id: 'e1', userId: 'u1' })];

    const deadlines: Date[] = [];
    const innerDb = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([ballot])
        .mockResolvedValueOnce(entries),
      execute: vi.fn(async (_sql: string, params?: unknown[]) => {
        if (params) {
          for (const p of params) {
            if (p instanceof Date && p.getTime() > Date.now()) {
              deadlines.push(p);
            }
          }
        }
      }),
    });

    await conductDraw('ballot-1', 'org-1', { db: innerDb });

    expect(deadlines.length).toBeGreaterThan(0);
    // Deadline should be approximately 24 hours from now
    const expectedMin = Date.now() + 23 * 60 * 60 * 1000;
    const expectedMax = Date.now() + 25 * 60 * 60 * 1000;
    const deadline = deadlines[0] as Date;
    expect(deadline.getTime()).toBeGreaterThan(expectedMin);
    expect(deadline.getTime()).toBeLessThan(expectedMax);
  });

  it('handles case where entries count equals totalSlots (no waitlist)', async () => {
    const ballot = makeBallot({ status: 'closed', totalSlots: 3 });
    const entries = [
      makeEntry({ id: 'e1', userId: 'u1' }),
      makeEntry({ id: 'e2', userId: 'u2' }),
      makeEntry({ id: 'e3', userId: 'u3' }),
    ];

    const innerDb = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([ballot])
        .mockResolvedValueOnce(entries),
    });

    const result = await conductDraw('ballot-1', 'org-1', { db: innerDb });

    expect(result.selectedCount).toBe(3);
    expect(result.waitlistedCount).toBe(0);
  });
});

// ── getMyBallotStatus ─────────────────────────────────────────────────────────

describe('getMyBallotStatus', () => {
  it('returns BallotEntry when user has registered', async () => {
    const entry = makeEntry({ userId: 'user-1', status: 'selected' });
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([entry]) });

    const result = await getMyBallotStatus('ballot-1', 'user-1', { db });

    expect(result).not.toBeNull();
    expect(result?.status).toBe('selected');
    expect(result?.userId).toBe('user-1');
  });

  it('returns null when user has not registered', async () => {
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([]) });

    const result = await getMyBallotStatus('ballot-1', 'user-99', { db });

    expect(result).toBeNull();
  });
});

// ── forfeitSlot ───────────────────────────────────────────────────────────────

describe('forfeitSlot', () => {
  it('promotes first waitlisted entry to selected when slot is forfeited', async () => {
    const selectedEntry = makeEntry({ id: 'e1', userId: 'user-1', status: 'selected', rank: 1 });
    const waitlistedEntry = makeEntry({ id: 'e2', userId: 'user-2', status: 'waitlisted', rank: 3 });
    const ballot = makeBallot({ status: 'drawn', purchaseWindowHours: 48 });

    const updatedEntryIds: string[] = [];
    const innerDb = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([selectedEntry])    // fetch entry to forfeit
        .mockResolvedValueOnce([waitlistedEntry])  // fetch first waitlisted
        .mockResolvedValueOnce([ballot]),           // fetch ballot for window hours
      execute: vi.fn(async (_sql: string, params?: unknown[]) => {
        if (params && typeof params[params.length - 1] === 'string') {
          updatedEntryIds.push(params[params.length - 1] as string);
        }
      }),
    });

    await forfeitSlot('e1', 'user-1', { db: innerDb });

    expect(innerDb.execute).toHaveBeenCalledTimes(2);
    // First call should forfeit e1, second should promote e2
    const firstCall = (innerDb.execute as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(firstCall[0]).toContain("'forfeited'");
    const secondCall = (innerDb.execute as ReturnType<typeof vi.fn>).mock.calls[1] as [string, unknown[]];
    expect(secondCall[0]).toContain("'selected'");
  });

  it('throws ENTRY_NOT_SELECTED when entry is not in selected status', async () => {
    const waitlistedEntry = makeEntry({ id: 'e1', status: 'waitlisted', rank: 2 });
    const innerDb = makeDb({
      query: vi.fn().mockResolvedValueOnce([waitlistedEntry]),
    });

    await expect(forfeitSlot('e1', 'user-1', { db: innerDb })).rejects.toMatchObject({
      code: 'ENTRY_NOT_SELECTED',
    });
  });

  it('throws ENTRY_NOT_FOUND when entry does not exist', async () => {
    const innerDb = makeDb({
      query: vi.fn().mockResolvedValueOnce([]),
    });

    await expect(forfeitSlot('missing', 'user-1', { db: innerDb })).rejects.toMatchObject({
      code: 'ENTRY_NOT_FOUND',
    });
  });

  it('does not promote anyone when no waitlisted entries exist', async () => {
    const selectedEntry = makeEntry({ id: 'e1', userId: 'user-1', status: 'selected', rank: 1 });
    const innerDb = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([selectedEntry])  // fetch entry to forfeit
        .mockResolvedValueOnce([]),               // no waitlisted entries
    });

    await forfeitSlot('e1', 'user-1', { db: innerDb });

    // Only one execute call — for forfeiting, not for promotion
    expect(innerDb.execute).toHaveBeenCalledOnce();
    const call = (innerDb.execute as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(call[0]).toContain("'forfeited'");
  });

  it('sets new purchaseDeadlineAt for promoted waitlisted entry', async () => {
    const selectedEntry = makeEntry({ id: 'e1', userId: 'user-1', status: 'selected', rank: 1 });
    const waitlistedEntry = makeEntry({ id: 'e2', userId: 'user-2', status: 'waitlisted', rank: 3 });
    const ballot = makeBallot({ status: 'drawn', purchaseWindowHours: 48 });

    const deadlines: Date[] = [];
    const innerDb = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([selectedEntry])
        .mockResolvedValueOnce([waitlistedEntry])
        .mockResolvedValueOnce([ballot]),
      execute: vi.fn(async (_sql: string, params?: unknown[]) => {
        if (params) {
          for (const p of params) {
            if (p instanceof Date && p.getTime() > Date.now()) {
              deadlines.push(p);
            }
          }
        }
      }),
    });

    await forfeitSlot('e1', 'user-1', { db: innerDb });

    expect(deadlines.length).toBeGreaterThan(0);
    const expectedMin = Date.now() + 47 * 60 * 60 * 1000;
    const expectedMax = Date.now() + 49 * 60 * 60 * 1000;
    const deadline = deadlines[0] as Date;
    expect(deadline.getTime()).toBeGreaterThan(expectedMin);
    expect(deadline.getTime()).toBeLessThan(expectedMax);
  });
});
