/**
 * Tests for shift swap service — lifecycle and validation.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createSwapRequest,
  acceptSwap,
  approveSwap,
  rejectSwap,
  cancelSwapRequest,
  listSwapRequests,
} from '../services/swap.service.js';

function makeDb() {
  const db: any = {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return db;
}

const PROMOTER = 'p-1';
const SHIFT_ID = 'sh-1';
const REQUESTER = 's-requester';
const ACCEPTER = 's-accepter';
const SWAP_ID = 'sw-1';

const baseSwap = {
  id: SWAP_ID,
  shiftId: SHIFT_ID,
  requesterStaffId: REQUESTER,
  targetStaffId: null,
  accepterStaffId: null,
  status: 'open' as const,
  reason: null,
  createdAt: '2026-04-10T10:00:00Z',
  respondedAt: null,
  approvedAt: null,
  promoterId: PROMOTER,
};

describe('createSwapRequest', () => {
  it('creates open swap request when requester owns shift', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ id: SHIFT_ID, staff_id: REQUESTER, status: 'scheduled' }]) // shift check
      .mockResolvedValueOnce([]) // no existing open swap
      .mockResolvedValueOnce([baseSwap]); // INSERT

    const result = await createSwapRequest(SHIFT_ID, REQUESTER, PROMOTER, {}, { db });
    expect(result.status).toBe('open');
    expect(result.requesterStaffId).toBe(REQUESTER);
  });

  it('throws STAFF_PERMISSION_DENIED when requester is not the assigned staff', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ id: SHIFT_ID, staff_id: 'other-staff', status: 'scheduled' }]);

    await expect(
      createSwapRequest(SHIFT_ID, REQUESTER, PROMOTER, {}, { db }),
    ).rejects.toMatchObject({ code: 'STAFF_PERMISSION_DENIED' });
  });

  it('throws SWAP_REQUEST_INVALID_STATE when active swap already exists', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ id: SHIFT_ID, staff_id: REQUESTER, status: 'scheduled' }])
      .mockResolvedValueOnce([{ id: 'existing-swap' }]); // existing open swap

    await expect(
      createSwapRequest(SHIFT_ID, REQUESTER, PROMOTER, {}, { db }),
    ).rejects.toMatchObject({ code: 'SWAP_REQUEST_INVALID_STATE' });
  });

  it('throws SHIFT_INVALID_STATUS_TRANSITION for completed shift', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ id: SHIFT_ID, staff_id: REQUESTER, status: 'completed' }]);

    await expect(
      createSwapRequest(SHIFT_ID, REQUESTER, PROMOTER, {}, { db }),
    ).rejects.toMatchObject({ code: 'SHIFT_INVALID_STATUS_TRANSITION' });
  });
});

describe('acceptSwap', () => {
  it('moves swap to pending_approval when accepter is different from requester', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ // FOR UPDATE lock
        ...baseSwap,
        status: 'open',
        shift_id: SHIFT_ID,
        target_staff_id: null,
        requester_staff_id: REQUESTER,
      }])
      .mockResolvedValueOnce([{ id: ACCEPTER, status: 'active' }]) // accepter lookup
      .mockResolvedValueOnce([{ ...baseSwap, status: 'pending_approval', accepterStaffId: ACCEPTER }]);

    const result = await acceptSwap(SWAP_ID, ACCEPTER, PROMOTER, { db });
    expect(result.status).toBe('pending_approval');
  });

  it('throws SWAP_REQUEST_INVALID_STATE when requester tries to accept own swap', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{
      ...baseSwap,
      status: 'open',
      shift_id: SHIFT_ID,
      target_staff_id: null,
      requester_staff_id: REQUESTER,
    }]);

    await expect(
      acceptSwap(SWAP_ID, REQUESTER, PROMOTER, { db }), // requester = accepter
    ).rejects.toMatchObject({ code: 'SWAP_REQUEST_INVALID_STATE' });
  });

  it('throws SWAP_REQUEST_INVALID_STATE when swap is not open', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{
      ...baseSwap,
      status: 'approved', // already approved
      shift_id: SHIFT_ID,
      target_staff_id: null,
      requester_staff_id: REQUESTER,
    }]);

    await expect(
      acceptSwap(SWAP_ID, ACCEPTER, PROMOTER, { db }),
    ).rejects.toMatchObject({ code: 'SWAP_REQUEST_INVALID_STATE' });
  });
});

describe('approveSwap', () => {
  it('reassigns shift and marks swap approved', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ id: SWAP_ID, shift_id: SHIFT_ID, accepter_staff_id: ACCEPTER, status: 'pending_approval' }]) // FOR UPDATE
      .mockResolvedValueOnce([{ ...baseSwap, status: 'approved', approvedAt: '2026-04-10T11:00:00Z' }]); // update

    const result = await approveSwap(SWAP_ID, PROMOTER, { db });
    expect(result.status).toBe('approved');
    // shift reassignment
    const updateCall = db.execute.mock.calls.find((c: any[]) =>
      c[0].includes('UPDATE platform.staff_shifts'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toContain(ACCEPTER);
  });

  it('throws SWAP_REQUEST_INVALID_STATE when swap is not pending_approval', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ id: SWAP_ID, shift_id: SHIFT_ID, accepter_staff_id: null, status: 'open' }]);

    await expect(
      approveSwap(SWAP_ID, PROMOTER, { db }),
    ).rejects.toMatchObject({ code: 'SWAP_REQUEST_INVALID_STATE' });
  });
});

describe('rejectSwap', () => {
  it('sets status to rejected', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ ...baseSwap, status: 'rejected' }]);

    const result = await rejectSwap(SWAP_ID, PROMOTER, { db });
    expect(result.status).toBe('rejected');
  });
});

describe('cancelSwapRequest', () => {
  it('cancels swap by requester', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ ...baseSwap, status: 'cancelled' }]);

    const result = await cancelSwapRequest(SWAP_ID, REQUESTER, PROMOTER, { db });
    expect(result.status).toBe('cancelled');
  });
});

describe('listSwapRequests', () => {
  it('returns all swaps for promoter', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([baseSwap]);

    const result = await listSwapRequests(PROMOTER, undefined, { db });
    expect(result).toHaveLength(1);
    expect(result[0].promoterId).toBe(PROMOTER);
  });

  it('filters by status', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);

    const result = await listSwapRequests(PROMOTER, 'approved', { db });
    expect(result).toHaveLength(0);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('status');
  });
});
