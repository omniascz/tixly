import { describe, it, expect, vi } from 'vitest';
import {
  createSwapRequest,
  acceptSwap,
  approveSwap,
  rejectSwap,
  cancelSwapRequest,
  listSwapRequests,
} from '../services/swap.service.js';
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
const SHIFT_ID = 'sh-1';
const STAFF_A = 'staff-a';
const STAFF_B = 'staff-b';
const SWAP_ID = 'sw-1';

const SWAP_ROW = {
  id: SWAP_ID,
  shiftId: SHIFT_ID,
  requesterStaffId: STAFF_A,
  targetStaffId: null,
  accepterStaffId: null,
  status: 'open',
  reason: null,
  createdAt: '2026-04-11T10:00:00Z',
  respondedAt: null,
  approvedAt: null,
  promoterId: PROMOTER,
};

describe('createSwapRequest', () => {
  it('creates an open swap request by requester', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ id: SHIFT_ID, staff_id: STAFF_A, status: 'scheduled' }])
      .mockResolvedValueOnce([])             // no existing swap
      .mockResolvedValueOnce([SWAP_ROW]);    // insert
    const r = await createSwapRequest(SHIFT_ID, STAFF_A, PROMOTER, { reason: 'Conflict' }, deps(db));
    expect(r.status).toBe('open');
  });

  it('rejects if requester is not the assigned staff', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ id: SHIFT_ID, staff_id: 'other-staff', status: 'scheduled' }]);
    await expect(createSwapRequest(SHIFT_ID, STAFF_A, PROMOTER, {}, deps(db)))
      .rejects.toMatchObject({ code: 'STAFF_PERMISSION_DENIED' });
  });

  it('rejects if shift is in terminal state', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ id: SHIFT_ID, staff_id: STAFF_A, status: 'completed' }]);
    await expect(createSwapRequest(SHIFT_ID, STAFF_A, PROMOTER, {}, deps(db)))
      .rejects.toMatchObject({ code: 'SHIFT_INVALID_STATUS_TRANSITION' });
  });

  it('rejects if there is already an active swap for this shift', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ id: SHIFT_ID, staff_id: STAFF_A, status: 'scheduled' }])
      .mockResolvedValueOnce([{ id: 'other-swap' }]);
    await expect(createSwapRequest(SHIFT_ID, STAFF_A, PROMOTER, {}, deps(db)))
      .rejects.toMatchObject({ code: 'SWAP_REQUEST_INVALID_STATE' });
  });
});

describe('acceptSwap', () => {
  it('transitions open swap to pending_approval when accepted', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ ...SWAP_ROW, requester_staff_id: STAFF_A, target_staff_id: null, shift_id: SHIFT_ID }])
      .mockResolvedValueOnce([{ id: STAFF_B, status: 'active' }])
      .mockResolvedValueOnce([{ ...SWAP_ROW, status: 'pending_approval', accepterStaffId: STAFF_B }]);
    const r = await acceptSwap(SWAP_ID, STAFF_B, PROMOTER, deps(db));
    expect(r.status).toBe('pending_approval');
  });

  it('rejects self-acceptance', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ ...SWAP_ROW, requester_staff_id: STAFF_A, target_staff_id: null, shift_id: SHIFT_ID }]);
    await expect(acceptSwap(SWAP_ID, STAFF_A, PROMOTER, deps(db))).rejects.toMatchObject({ code: 'SWAP_REQUEST_INVALID_STATE' });
  });

  it('rejects non-target staff when swap is targeted', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{
      ...SWAP_ROW, requester_staff_id: STAFF_A, target_staff_id: 'target-only', shift_id: SHIFT_ID,
    }]);
    await expect(acceptSwap(SWAP_ID, STAFF_B, PROMOTER, deps(db))).rejects.toMatchObject({ code: 'STAFF_PERMISSION_DENIED' });
  });

  it('rejects if swap status is not open', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{
      ...SWAP_ROW, status: 'pending_approval', requester_staff_id: STAFF_A, target_staff_id: null, shift_id: SHIFT_ID,
    }]);
    await expect(acceptSwap(SWAP_ID, STAFF_B, PROMOTER, deps(db))).rejects.toMatchObject({ code: 'SWAP_REQUEST_INVALID_STATE' });
  });

  it('rejects inactive accepter', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ ...SWAP_ROW, requester_staff_id: STAFF_A, target_staff_id: null, shift_id: SHIFT_ID }])
      .mockResolvedValueOnce([{ id: STAFF_B, status: 'archived' }]);
    await expect(acceptSwap(SWAP_ID, STAFF_B, PROMOTER, deps(db))).rejects.toMatchObject({ code: 'STAFF_INACTIVE' });
  });
});

describe('approveSwap', () => {
  it('approves and reassigns shift', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ id: SWAP_ID, shift_id: SHIFT_ID, accepter_staff_id: STAFF_B, status: 'pending_approval' }])
      .mockResolvedValueOnce([{ ...SWAP_ROW, status: 'approved' }]);
    const r = await approveSwap(SWAP_ID, PROMOTER, deps(db));
    expect(r.status).toBe('approved');
    // Shift reassignment uses tx.execute
    expect(db.execute).toHaveBeenCalled();
    const execCall = db.execute.mock.calls[0];
    expect(execCall[1]).toEqual([STAFF_B, SHIFT_ID]);
  });

  it('rejects if swap is not pending_approval', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ id: SWAP_ID, shift_id: SHIFT_ID, accepter_staff_id: STAFF_B, status: 'open' }]);
    await expect(approveSwap(SWAP_ID, PROMOTER, deps(db))).rejects.toMatchObject({ code: 'SWAP_REQUEST_INVALID_STATE' });
  });
});

describe('rejectSwap', () => {
  it('sets status to rejected', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ ...SWAP_ROW, status: 'rejected' }]);
    const r = await rejectSwap(SWAP_ID, PROMOTER, deps(db));
    expect(r.status).toBe('rejected');
  });

  it('throws when not found or terminal', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);
    await expect(rejectSwap(SWAP_ID, PROMOTER, deps(db))).rejects.toThrow(StaffError);
  });
});

describe('cancelSwapRequest', () => {
  it('allows requester to cancel their open request', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ ...SWAP_ROW, status: 'cancelled' }]);
    const r = await cancelSwapRequest(SWAP_ID, STAFF_A, PROMOTER, deps(db));
    expect(r.status).toBe('cancelled');
  });

  it('throws when caller is not the requester', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);
    await expect(cancelSwapRequest(SWAP_ID, STAFF_B, PROMOTER, deps(db))).rejects.toThrow(StaffError);
  });
});

describe('listSwapRequests', () => {
  it('lists all swaps without filter', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([SWAP_ROW]);
    const r = await listSwapRequests(PROMOTER, undefined, deps(db));
    expect(r).toHaveLength(1);
  });

  it('filters by status', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([SWAP_ROW]);
    await listSwapRequests(PROMOTER, 'pending_approval', deps(db));
    const params = db.query.mock.calls[0][1];
    expect(params).toContain('pending_approval');
  });
});
