import { RuleError } from '../lib/rules-errors';
import type { RuleDB } from './rule.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalInput {
  ruleId: string;
  slotId: string;
  userId: string;
  promoterId: string;
  requestData?: Record<string, unknown>;
}

export interface ApprovalRequest {
  id: string;
  ruleId: string;
  bookingId: string | null;
  slotId: string;
  userId: string;
  promoterId: string;
  status: ApprovalStatus;
  requestData: Record<string, unknown>;
  reviewerId: string | null;
  reviewerNotes: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  expiresAt: string;
  ruleName?: string;
  ruleType?: string;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ApprovalRow {
  id: string;
  rule_id: string;
  booking_id: string | null;
  slot_id: string;
  user_id: string;
  promoter_id: string;
  status: ApprovalStatus;
  request_data: Record<string, unknown>;
  reviewer_id: string | null;
  reviewer_notes: string | null;
  requested_at: string;
  reviewed_at: string | null;
  expires_at: string;
  rule_name?: string;
  rule_type?: string;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapApproval(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    ruleId: row.rule_id,
    bookingId: row.booking_id,
    slotId: row.slot_id,
    userId: row.user_id,
    promoterId: row.promoter_id,
    status: row.status,
    requestData: row.request_data ?? {},
    reviewerId: row.reviewer_id,
    reviewerNotes: row.reviewer_notes,
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at,
    expiresAt: row.expires_at,
    ruleName: row.rule_name,
    ruleType: row.rule_type,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function createApprovalRequest(
  input: ApprovalInput,
  db: RuleDB,
): Promise<ApprovalRequest> {
  await db.execute(
    `INSERT INTO reservations.approval_requests
       (rule_id, slot_id, user_id, promoter_id, request_data)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      input.ruleId,
      input.slotId,
      input.userId,
      input.promoterId,
      JSON.stringify(input.requestData ?? {}),
    ],
  );

  const { rows } = await db.query<ApprovalRow>(
    `SELECT ar.*, r.name AS rule_name, r.rule_type
     FROM reservations.approval_requests ar
     JOIN reservations.rules r ON r.id = ar.rule_id
     WHERE ar.rule_id = $1 AND ar.user_id = $2 AND ar.slot_id = $3
     ORDER BY ar.requested_at DESC LIMIT 1`,
    [input.ruleId, input.userId, input.slotId],
  );

  if (!rows[0]) {
    throw new RuleError('APPROVAL_NOT_FOUND');
  }

  return mapApproval(rows[0]);
}

export async function getApprovalRequest(
  requestId: string,
  db: RuleDB,
): Promise<ApprovalRequest> {
  const { rows } = await db.query<ApprovalRow>(
    `SELECT ar.*, r.name AS rule_name, r.rule_type
     FROM reservations.approval_requests ar
     JOIN reservations.rules r ON r.id = ar.rule_id
     WHERE ar.id = $1`,
    [requestId],
  );

  if (!rows[0]) {
    throw new RuleError('APPROVAL_NOT_FOUND');
  }

  return mapApproval(rows[0]);
}

export async function listPendingApprovals(
  promoterId: string,
  db: RuleDB,
): Promise<ApprovalRequest[]> {
  const { rows } = await db.query<ApprovalRow>(
    `SELECT ar.*, r.name AS rule_name, r.rule_type
     FROM reservations.approval_requests ar
     JOIN reservations.rules r ON r.id = ar.rule_id
     WHERE ar.promoter_id = $1 AND ar.status = 'pending'
     ORDER BY ar.requested_at ASC`,
    [promoterId],
  );

  return rows.map(mapApproval);
}

export async function approveRequest(
  requestId: string,
  reviewerId: string,
  notes: string | null,
  db: RuleDB,
): Promise<ApprovalRequest> {
  const { rows: existing } = await db.query<ApprovalRow>(
    `SELECT * FROM reservations.approval_requests WHERE id = $1`,
    [requestId],
  );

  if (!existing[0]) {
    throw new RuleError('APPROVAL_NOT_FOUND');
  }

  if (existing[0].status !== 'pending') {
    throw new RuleError('APPROVAL_ALREADY_DECIDED');
  }

  await db.execute(
    `UPDATE reservations.approval_requests
     SET status = 'approved', reviewer_id = $1, reviewer_notes = $2, reviewed_at = NOW()
     WHERE id = $3`,
    [reviewerId, notes, requestId],
  );

  const { rows } = await db.query<ApprovalRow>(
    `SELECT ar.*, r.name AS rule_name, r.rule_type
     FROM reservations.approval_requests ar
     JOIN reservations.rules r ON r.id = ar.rule_id
     WHERE ar.id = $1`,
    [requestId],
  );

  return mapApproval(rows[0]);
}

export async function rejectRequest(
  requestId: string,
  reviewerId: string,
  notes: string | null,
  db: RuleDB,
): Promise<ApprovalRequest> {
  const { rows: existing } = await db.query<ApprovalRow>(
    `SELECT * FROM reservations.approval_requests WHERE id = $1`,
    [requestId],
  );

  if (!existing[0]) {
    throw new RuleError('APPROVAL_NOT_FOUND');
  }

  if (existing[0].status !== 'pending') {
    throw new RuleError('APPROVAL_ALREADY_DECIDED');
  }

  await db.execute(
    `UPDATE reservations.approval_requests
     SET status = 'rejected', reviewer_id = $1, reviewer_notes = $2, reviewed_at = NOW()
     WHERE id = $3`,
    [reviewerId, notes, requestId],
  );

  const { rows } = await db.query<ApprovalRow>(
    `SELECT ar.*, r.name AS rule_name, r.rule_type
     FROM reservations.approval_requests ar
     JOIN reservations.rules r ON r.id = ar.rule_id
     WHERE ar.id = $1`,
    [requestId],
  );

  return mapApproval(rows[0]);
}

export async function expireOldRequests(db: RuleDB): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `UPDATE reservations.approval_requests
     SET status = 'expired'
     WHERE expires_at < NOW() AND status = 'pending'
     RETURNING id`,
    [],
  );

  return rows.length;
}

export async function getUserApprovals(
  userId: string,
  db: RuleDB,
): Promise<ApprovalRequest[]> {
  const { rows } = await db.query<ApprovalRow>(
    `SELECT ar.*, r.name AS rule_name, r.rule_type
     FROM reservations.approval_requests ar
     JOIN reservations.rules r ON r.id = ar.rule_id
     WHERE ar.user_id = $1
     ORDER BY ar.requested_at DESC`,
    [userId],
  );

  return rows.map(mapApproval);
}
