import { describe, it, expect, vi } from 'vitest';
import {
  createAvailabilityBlock,
  getAvailabilityBlock,
  listAvailabilityForStaff,
  approveAvailability,
  deleteAvailability,
  hasAvailabilityConflict,
} from '../services/availability.service.js';
import { StaffError } from '../lib/staff-errors.js';

function makeDb() {
  const db: any = {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return db;
}
const deps = (db: any) => ({ db });

const PROMOTER = 'p-1';
const STAFF_ID = 's-1';
const BLOCK_ID = 'b-1';

const BLOCK_ROW = {
  id: BLOCK_ID,
  staffId: STAFF_ID,
  promoterId: PROMOTER,
  startsAt: '2026-06-01T00:00:00Z',
  endsAt: '2026-06-15T00:00:00Z',
  reason: 'vacation',
  notes: null,
  approved: false,
  createdAt: '2026-04-01T10:00:00Z',
};

describe('createAvailabilityBlock', () => {
  it('creates a vacation block for active staff', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ id: STAFF_ID, status: 'active' }])  // staff check
      .mockResolvedValueOnce([BLOCK_ROW]);                          // insert
    const r = await createAvailabilityBlock(STAFF_ID, PROMOTER, {
      startsAt: '2026-06-01T00:00:00Z',
      endsAt: '2026-06-15T00:00:00Z',
      reason: 'vacation',
    }, deps(db));
    expect(r.reason).toBe('vacation');
    expect(r.approved).toBe(false);
  });

  it('rejects when end <= start', async () => {
    const db = makeDb();
    await expect(createAvailabilityBlock(STAFF_ID, PROMOTER, {
      startsAt: '2026-06-15T00:00:00Z',
      endsAt: '2026-06-01T00:00:00Z',
      reason: 'vacation',
    }, deps(db))).rejects.toThrow(StaffError);
  });

  it('throws STAFF_NOT_FOUND for unknown staff', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);
    await expect(createAvailabilityBlock(STAFF_ID, PROMOTER, {
      startsAt: '2026-06-01T00:00:00Z',
      endsAt: '2026-06-15T00:00:00Z',
      reason: 'sick',
    }, deps(db))).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
  });

  it('throws STAFF_INACTIVE for archived staff', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ id: STAFF_ID, status: 'archived' }]);
    await expect(createAvailabilityBlock(STAFF_ID, PROMOTER, {
      startsAt: '2026-06-01T00:00:00Z',
      endsAt: '2026-06-15T00:00:00Z',
      reason: 'vacation',
    }, deps(db))).rejects.toMatchObject({ code: 'STAFF_INACTIVE' });
  });
});

describe('getAvailabilityBlock', () => {
  it('returns block for correct promoter', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([BLOCK_ROW]);
    const r = await getAvailabilityBlock(BLOCK_ID, PROMOTER, deps(db));
    expect(r.id).toBe(BLOCK_ID);
  });

  it('throws AVAILABILITY_NOT_FOUND for wrong promoter (anti-enumeration)', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);
    await expect(getAvailabilityBlock(BLOCK_ID, 'other', deps(db))).rejects.toMatchObject({ code: 'AVAILABILITY_NOT_FOUND' });
  });
});

describe('listAvailabilityForStaff', () => {
  it('lists all blocks without filters', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([BLOCK_ROW]);
    const r = await listAvailabilityForStaff(STAFF_ID, PROMOTER, undefined, undefined, deps(db));
    expect(r).toHaveLength(1);
    const params = db.query.mock.calls[0][1];
    expect(params).toEqual([STAFF_ID, PROMOTER]);
  });

  it('applies date filters', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([BLOCK_ROW]);
    await listAvailabilityForStaff(STAFF_ID, PROMOTER, '2026-06-01T00:00:00Z', '2026-06-30T00:00:00Z', deps(db));
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('ends_at >= $3');
    expect(sql).toContain('starts_at <= $4');
  });
});

describe('approveAvailability', () => {
  it('approves a pending block', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ ...BLOCK_ROW, approved: true }]);
    const r = await approveAvailability(BLOCK_ID, PROMOTER, deps(db));
    expect(r.approved).toBe(true);
  });

  it('throws when block not found', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);
    await expect(approveAvailability(BLOCK_ID, PROMOTER, deps(db))).rejects.toThrow(StaffError);
  });
});

describe('deleteAvailability', () => {
  it('deletes successfully', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ id: BLOCK_ID }]);
    await expect(deleteAvailability(BLOCK_ID, PROMOTER, deps(db))).resolves.toBeUndefined();
  });

  it('throws when not found', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);
    await expect(deleteAvailability(BLOCK_ID, PROMOTER, deps(db))).rejects.toThrow(StaffError);
  });
});

describe('hasAvailabilityConflict', () => {
  it('returns true when approved block overlaps', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ cnt: '1' }]);
    expect(await hasAvailabilityConflict(STAFF_ID, '2026-06-05T00:00:00Z', '2026-06-06T00:00:00Z', deps(db)))
      .toBe(true);
  });

  it('returns false when no conflict', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ cnt: '0' }]);
    expect(await hasAvailabilityConflict(STAFF_ID, '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', deps(db)))
      .toBe(false);
  });

  it('only counts approved blocks', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ cnt: '0' }]);
    await hasAvailabilityConflict(STAFF_ID, '2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z', deps(db));
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('approved = TRUE');
  });
});
