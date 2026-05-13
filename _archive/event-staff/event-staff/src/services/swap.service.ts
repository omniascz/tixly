/**
 * Shift swap requests — staff can request to swap their shift with
 * another staff member. Promoter approves or rejects.
 *
 * Workflow:
 *   1. Staff A creates swap request for shift S, optionally targeting Staff B
 *   2. Staff B (or any staff) accepts → status 'pending_approval'
 *   3. Promoter approves → shift S reassigned to Staff B (or new staff)
 *   4. Or promoter rejects → status 'rejected'
 */
import { StaffError } from '../lib/staff-errors.js';
import type { DbAdapter } from '../lib/service-container.js';

export type SwapStatus = 'open' | 'pending_approval' | 'approved' | 'rejected' | 'cancelled';

export interface SwapRequest {
  id: string;
  shiftId: string;
  requesterStaffId: string;
  targetStaffId: string | null;  // null = open to anyone
  accepterStaffId: string | null;
  status: SwapStatus;
  reason: string | null;
  createdAt: string;
  respondedAt: string | null;
  approvedAt: string | null;
  promoterId: string;
}

export interface ServiceDeps {
  db: DbAdapter;
}

// ---------------------------------------------------------------------------
// Create swap request
// ---------------------------------------------------------------------------

export async function createSwapRequest(
  shiftId: string,
  requesterStaffId: string,
  promoterId: string,
  input: { targetStaffId?: string; reason?: string },
  deps: ServiceDeps,
): Promise<SwapRequest> {
  // Verify shift exists, belongs to promoter, and requester is the assigned staff
  const shiftRows = await deps.db.query<{ id: string; staff_id: string; status: string }>(
    `SELECT id, staff_id, status FROM platform.staff_shifts
     WHERE id = $1 AND promoter_id = $2`,
    [shiftId, promoterId],
  );
  if (shiftRows.length === 0) throw new StaffError('SHIFT_NOT_FOUND');
  if (shiftRows[0].staff_id !== requesterStaffId) throw new StaffError('STAFF_PERMISSION_DENIED');
  if (['completed', 'cancelled', 'no_show'].includes(shiftRows[0].status)) {
    throw new StaffError('SHIFT_INVALID_STATUS_TRANSITION', 'Nelze vyměnit ukončenou směnu.');
  }

  // Check no existing open swap request for this shift
  const existing = await deps.db.query<{ id: string }>(
    `SELECT id FROM platform.staff_shift_swaps
     WHERE shift_id = $1 AND status IN ('open', 'pending_approval')`,
    [shiftId],
  );
  if (existing.length > 0) throw new StaffError('SWAP_REQUEST_INVALID_STATE', 'Pro tuto směnu již existuje aktivní žádost.');

  const rows = await deps.db.query<SwapRequest>(
    `INSERT INTO platform.staff_shift_swaps
       (shift_id, requester_staff_id, target_staff_id, reason, promoter_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, shift_id AS "shiftId",
               requester_staff_id AS "requesterStaffId",
               target_staff_id AS "targetStaffId",
               accepter_staff_id AS "accepterStaffId",
               status, reason,
               created_at::text AS "createdAt",
               responded_at::text AS "respondedAt",
               approved_at::text AS "approvedAt",
               promoter_id AS "promoterId"`,
    [shiftId, requesterStaffId, input.targetStaffId ?? null, input.reason ?? null, promoterId],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Accept swap — staff B picks up the open request
// ---------------------------------------------------------------------------

export async function acceptSwap(
  swapId: string,
  accepterStaffId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<SwapRequest> {
  return deps.db.transaction(async (tx) => {
    const rows = await tx.query<SwapRequest & { shift_id: string; target_staff_id: string | null; requester_staff_id: string }>(
      `SELECT id, shift_id AS "shiftId", requester_staff_id AS "requesterStaffId",
              target_staff_id AS "targetStaffId", accepter_staff_id AS "accepterStaffId",
              status, reason, created_at::text AS "createdAt",
              responded_at::text AS "respondedAt", approved_at::text AS "approvedAt",
              promoter_id AS "promoterId",
              shift_id, target_staff_id, requester_staff_id
       FROM platform.staff_shift_swaps
       WHERE id = $1 AND promoter_id = $2
       FOR UPDATE`,
      [swapId, promoterId],
    );
    if (rows.length === 0) throw new StaffError('SWAP_REQUEST_NOT_FOUND');
    const swap = rows[0];

    if (swap.status !== 'open') throw new StaffError('SWAP_REQUEST_INVALID_STATE');
    if (swap.requester_staff_id === accepterStaffId) {
      throw new StaffError('SWAP_REQUEST_INVALID_STATE', 'Nelze akceptovat vlastní žádost.');
    }
    // If targeted, only target can accept
    if (swap.target_staff_id && swap.target_staff_id !== accepterStaffId) {
      throw new StaffError('STAFF_PERMISSION_DENIED');
    }

    // Verify accepter is active staff of promoter
    const accepterRows = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM platform.staff_members
       WHERE id = $1 AND promoter_id = $2`,
      [accepterStaffId, promoterId],
    );
    if (accepterRows.length === 0) throw new StaffError('STAFF_NOT_FOUND');
    if (accepterRows[0].status !== 'active') throw new StaffError('STAFF_INACTIVE');

    const updated = await tx.query<SwapRequest>(
      `UPDATE platform.staff_shift_swaps
       SET status = 'pending_approval',
           accepter_staff_id = $1,
           responded_at = NOW()
       WHERE id = $2
       RETURNING id, shift_id AS "shiftId", requester_staff_id AS "requesterStaffId",
                 target_staff_id AS "targetStaffId", accepter_staff_id AS "accepterStaffId",
                 status, reason, created_at::text AS "createdAt",
                 responded_at::text AS "respondedAt", approved_at::text AS "approvedAt",
                 promoter_id AS "promoterId"`,
      [accepterStaffId, swapId],
    );
    return updated[0];
  });
}

// ---------------------------------------------------------------------------
// Promoter approves swap — reassigns the shift
// ---------------------------------------------------------------------------

export async function approveSwap(
  swapId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<SwapRequest> {
  return deps.db.transaction(async (tx) => {
    const rows = await tx.query<{ id: string; shift_id: string; accepter_staff_id: string | null; status: string }>(
      `SELECT id, shift_id, accepter_staff_id, status
       FROM platform.staff_shift_swaps
       WHERE id = $1 AND promoter_id = $2
       FOR UPDATE`,
      [swapId, promoterId],
    );
    if (rows.length === 0) throw new StaffError('SWAP_REQUEST_NOT_FOUND');
    const swap = rows[0];

    if (swap.status !== 'pending_approval') throw new StaffError('SWAP_REQUEST_INVALID_STATE');
    if (!swap.accepter_staff_id) throw new StaffError('SWAP_REQUEST_INVALID_STATE');

    // Reassign the shift
    await tx.execute(
      `UPDATE platform.staff_shifts SET staff_id = $1 WHERE id = $2`,
      [swap.accepter_staff_id, swap.shift_id],
    );

    const updated = await tx.query<SwapRequest>(
      `UPDATE platform.staff_shift_swaps
       SET status = 'approved', approved_at = NOW()
       WHERE id = $1
       RETURNING id, shift_id AS "shiftId", requester_staff_id AS "requesterStaffId",
                 target_staff_id AS "targetStaffId", accepter_staff_id AS "accepterStaffId",
                 status, reason, created_at::text AS "createdAt",
                 responded_at::text AS "respondedAt", approved_at::text AS "approvedAt",
                 promoter_id AS "promoterId"`,
      [swapId],
    );
    return updated[0];
  });
}

export async function rejectSwap(
  swapId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<SwapRequest> {
  const rows = await deps.db.query<SwapRequest>(
    `UPDATE platform.staff_shift_swaps
     SET status = 'rejected'
     WHERE id = $1 AND promoter_id = $2
       AND status IN ('open', 'pending_approval')
     RETURNING id, shift_id AS "shiftId", requester_staff_id AS "requesterStaffId",
               target_staff_id AS "targetStaffId", accepter_staff_id AS "accepterStaffId",
               status, reason, created_at::text AS "createdAt",
               responded_at::text AS "respondedAt", approved_at::text AS "approvedAt",
               promoter_id AS "promoterId"`,
    [swapId, promoterId],
  );
  if (rows.length === 0) throw new StaffError('SWAP_REQUEST_NOT_FOUND');
  return rows[0];
}

export async function cancelSwapRequest(
  swapId: string,
  requesterStaffId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<SwapRequest> {
  const rows = await deps.db.query<SwapRequest>(
    `UPDATE platform.staff_shift_swaps
     SET status = 'cancelled'
     WHERE id = $1 AND promoter_id = $2 AND requester_staff_id = $3
       AND status IN ('open', 'pending_approval')
     RETURNING id, shift_id AS "shiftId", requester_staff_id AS "requesterStaffId",
               target_staff_id AS "targetStaffId", accepter_staff_id AS "accepterStaffId",
               status, reason, created_at::text AS "createdAt",
               responded_at::text AS "respondedAt", approved_at::text AS "approvedAt",
               promoter_id AS "promoterId"`,
    [swapId, promoterId, requesterStaffId],
  );
  if (rows.length === 0) throw new StaffError('SWAP_REQUEST_NOT_FOUND');
  return rows[0];
}

export async function listSwapRequests(
  promoterId: string,
  statusFilter: SwapStatus | undefined,
  deps: ServiceDeps,
): Promise<SwapRequest[]> {
  const conds = ['promoter_id = $1'];
  const params: unknown[] = [promoterId];
  if (statusFilter) { params.push(statusFilter); conds.push(`status = $${params.length}`); }

  return deps.db.query<SwapRequest>(
    `SELECT id, shift_id AS "shiftId", requester_staff_id AS "requesterStaffId",
            target_staff_id AS "targetStaffId", accepter_staff_id AS "accepterStaffId",
            status, reason, created_at::text AS "createdAt",
            responded_at::text AS "respondedAt", approved_at::text AS "approvedAt",
            promoter_id AS "promoterId"
     FROM platform.staff_shift_swaps
     WHERE ${conds.join(' AND ')}
     ORDER BY created_at DESC`,
    params,
  );
}
