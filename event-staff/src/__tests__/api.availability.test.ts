/**
 * Integration-style tests for availability API routes.
 * Tests route logic using mocked services.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAvailabilityBlock,
  listAvailabilityForStaff,
  getAvailabilityBlock,
  approveAvailability,
  deleteAvailability,
} from '../services/availability.service.js';
import { StaffError } from '../lib/staff-errors.js';

// --- unit tests for the service layer (supplement availability.service.test.ts) ---

function makeDb() {
  const db: any = {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return db;
}

const PROMOTER = 'p-1';
const STAFF = 's-1';
const BLOCK_ID = 'b-1';

const baseBlock = {
  id: BLOCK_ID,
  staffId: STAFF,
  promoterId: PROMOTER,
  startsAt: '2026-04-20T08:00:00Z',
  endsAt: '2026-04-25T18:00:00Z',
  reason: 'vacation',
  notes: null,
  approved: false,
  createdAt: '2026-04-10T10:00:00Z',
};

describe('createAvailabilityBlock', () => {
  it('creates block for active staff', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ id: STAFF, status: 'active' }]) // staff check
      .mockResolvedValueOnce([baseBlock]); // INSERT RETURNING

    const result = await createAvailabilityBlock(
      STAFF,
      PROMOTER,
      { startsAt: '2026-04-20T08:00:00Z', endsAt: '2026-04-25T18:00:00Z', reason: 'vacation' },
      { db },
    );

    expect(result.id).toBe(BLOCK_ID);
    expect(result.reason).toBe('vacation');
    expect(result.approved).toBe(false);
  });

  it('throws AVAILABILITY_INVALID_RANGE when end <= start', async () => {
    const db = makeDb();
    await expect(
      createAvailabilityBlock(
        STAFF,
        PROMOTER,
        { startsAt: '2026-04-25T00:00:00Z', endsAt: '2026-04-20T00:00:00Z', reason: 'sick' },
        { db },
      ),
    ).rejects.toMatchObject({ code: 'AVAILABILITY_INVALID_RANGE' });
  });

  it('throws STAFF_NOT_FOUND for unknown staff', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]); // staff check returns empty

    await expect(
      createAvailabilityBlock(
        'unknown',
        PROMOTER,
        { startsAt: '2026-04-20T08:00:00Z', endsAt: '2026-04-25T18:00:00Z', reason: 'personal' },
        { db },
      ),
    ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
  });

  it('throws STAFF_INACTIVE for archived staff', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ id: STAFF, status: 'archived' }]);

    await expect(
      createAvailabilityBlock(
        STAFF,
        PROMOTER,
        { startsAt: '2026-04-20T08:00:00Z', endsAt: '2026-04-25T18:00:00Z', reason: 'vacation' },
        { db },
      ),
    ).rejects.toMatchObject({ code: 'STAFF_INACTIVE' });
  });
});

describe('approveAvailability', () => {
  it('sets approved=true and returns updated block', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ ...baseBlock, approved: true }]);

    const result = await approveAvailability(BLOCK_ID, PROMOTER, { db });
    expect(result.approved).toBe(true);
  });

  it('throws AVAILABILITY_NOT_FOUND for wrong promoter', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);

    await expect(
      approveAvailability(BLOCK_ID, 'wrong-promoter', { db }),
    ).rejects.toMatchObject({ code: 'AVAILABILITY_NOT_FOUND' });
  });
});

describe('hasAvailabilityConflict', () => {
  it('returns false when no approved blocks overlap', async () => {
    const { hasAvailabilityConflict } = await import('../services/availability.service.js');
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ cnt: '0' }]);

    const result = await hasAvailabilityConflict(
      STAFF,
      '2026-04-20T08:00:00Z',
      '2026-04-20T16:00:00Z',
      { db },
    );
    expect(result).toBe(false);
  });

  it('returns true when approved block overlaps shift time', async () => {
    const { hasAvailabilityConflict } = await import('../services/availability.service.js');
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ cnt: '1' }]);

    const result = await hasAvailabilityConflict(
      STAFF,
      '2026-04-22T08:00:00Z',
      '2026-04-22T16:00:00Z',
      { db },
    );
    expect(result).toBe(true);
  });
});
