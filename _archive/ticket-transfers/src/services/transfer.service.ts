// =============================================================================
// Ticket Transfer Service — Deadline Management
// Feature #37: Organizers set transfer cutoff to prevent speculation
// =============================================================================

export interface TransferDeadline {
  id: string;
  eventId: string;
  promoterId: string;
  ticketTypeId?: string;
  daysBeforeEvent: number;
  deadlineDatetime?: string;
  allowTransfers: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TransferLog {
  id: string;
  ticketId: string;
  eventId: string;
  fromUserId: string;
  toUserId?: string;
  transferStatus: 'pending' | 'completed' | 'cancelled' | 'deadline_exceeded';
  transferError?: string;
  attemptedAt: string;
  completedAt?: string;
}

export interface TransferCheckResult {
  allowed: boolean;
  reason?: string;
  deadlineDate?: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface TransferDeadlineRow {
  id: string;
  event_id: string;
  promoter_id: string;
  ticket_type_id: string | null;
  days_before_event: number;
  deadline_datetime: string | null;
  allow_transfers: boolean;
  created_at: string;
  updated_at: string;
}

interface TransferLogRow {
  id: string;
  ticket_id: string;
  event_id: string;
  from_user_id: string;
  to_user_id: string | null;
  transfer_status: string;
  transfer_error: string | null;
  attempted_at: string;
  completed_at: string | null;
}

function mapTransferDeadline(row: TransferDeadlineRow): TransferDeadline {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    ticketTypeId: row.ticket_type_id || undefined,
    daysBeforeEvent: row.days_before_event,
    deadlineDatetime: row.deadline_datetime || undefined,
    allowTransfers: row.allow_transfers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTransferLog(row: TransferLogRow): TransferLog {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    eventId: row.event_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id || undefined,
    transferStatus: row.transfer_status as any,
    transferError: row.transfer_error || undefined,
    attemptedAt: row.attempted_at,
    completedAt: row.completed_at || undefined,
  };
}

/**
 * Set transfer deadline for an event.
 * daysBeforeEvent: 1-31 days before event start
 */
export async function setTransferDeadline(
  eventId: string,
  promoterId: string,
  daysBeforeEvent: number,
  ticketTypeId?: string,
  db?: DbAdapter,
): Promise<TransferDeadline> {
  if (daysBeforeEvent < 1 || daysBeforeEvent > 31) {
    throw new Error('VALIDATION_ERROR: daysBeforeEvent must be 1-31');
  }

  const rows = await (db || { query: async () => [] } as DbAdapter).query<TransferDeadlineRow>(
    `INSERT INTO transfers.transfer_deadlines
       (event_id, promoter_id, ticket_type_id, days_before_event, allow_transfers)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (event_id, ticket_type_id)
     DO UPDATE SET
       days_before_event = $4,
       updated_at = NOW()
     RETURNING *`,
    [eventId, promoterId, ticketTypeId || null, daysBeforeEvent],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: transfer deadline failed');
  return mapTransferDeadline(rows[0]);
}

/**
 * Check if a transfer is allowed for a ticket.
 */
export async function isTransferAllowed(
  ticketId: string,
  eventId: string,
  db: DbAdapter,
): Promise<TransferCheckResult> {
  // Get ticket details
  const ticketRows = await db.query<{
    ticket_type_id: string;
  }>(
    `SELECT ticket_type_id FROM tickets.tickets WHERE id = $1 AND event_id = $2`,
    [ticketId, eventId],
  );

  if (!ticketRows[0]) {
    return { allowed: false, reason: 'TICKET_NOT_FOUND' };
  }

  // Get event date
  const eventRows = await db.query<{
    date: string;
  }>(
    `SELECT date FROM catalog.events WHERE id = $1`,
    [eventId],
  );

  if (!eventRows[0]) {
    return { allowed: false, reason: 'EVENT_NOT_FOUND' };
  }

  const eventDate = new Date(eventRows[0].date);

  // Get transfer deadline
  const deadlineRows = await db.query<TransferDeadlineRow>(
    `SELECT * FROM transfers.transfer_deadlines
     WHERE event_id = $1 AND (ticket_type_id = $2 OR ticket_type_id IS NULL)
     ORDER BY ticket_type_id DESC
     LIMIT 1`,
    [eventId, ticketRows[0].ticket_type_id],
  );

  if (!deadlineRows[0]) {
    // No deadline set, transfers allowed
    return { allowed: true };
  }

  const deadline = deadlineRows[0];

  // If transfers are disabled for this type
  if (!deadline.allow_transfers) {
    return {
      allowed: false,
      reason: 'TRANSFERS_DISABLED',
      deadlineDate: deadline.deadline_datetime || undefined,
    };
  }

  // Calculate deadline based on days before event
  const deadlineDate = new Date(eventDate);
  deadlineDate.setDate(deadlineDate.getDate() - deadline.days_before_event);

  const now = new Date();

  if (now > deadlineDate) {
    return {
      allowed: false,
      reason: 'DEADLINE_PASSED',
      deadlineDate: deadlineDate.toISOString(),
    };
  }

  return {
    allowed: true,
    deadlineDate: deadlineDate.toISOString(),
  };
}

/**
 * Enforce transfer deadline (prevent transfer if past deadline).
 */
export async function enforceTransferDeadline(
  ticketId: string,
  eventId: string,
  db: DbAdapter,
): Promise<boolean> {
  const checkResult = await isTransferAllowed(ticketId, eventId, db);
  return checkResult.allowed;
}

/**
 * Log a transfer attempt.
 */
export async function logTransferAttempt(
  ticketId: string,
  eventId: string,
  fromUserId: string,
  toUserId: string,
  transferStatus: 'pending' | 'completed' | 'cancelled' | 'deadline_exceeded',
  transferError?: string,
  db?: DbAdapter,
): Promise<TransferLog> {
  const rows = await (db || { query: async () => [] } as DbAdapter).query<TransferLogRow>(
    `INSERT INTO transfers.transfer_log
       (ticket_id, event_id, from_user_id, to_user_id, transfer_status, transfer_error)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [ticketId, eventId, fromUserId, toUserId, transferStatus, transferError || null],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: transfer log failed');
  return mapTransferLog(rows[0]);
}

/**
 * Mark a transfer as completed.
 */
export async function markTransferCompleted(
  transferLogId: string,
  db: DbAdapter,
): Promise<TransferLog> {
  const rows = await db.query<TransferLogRow>(
    `UPDATE transfers.transfer_log
     SET transfer_status = 'completed', completed_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [transferLogId],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: transfer not found');
  return mapTransferLog(rows[0]);
}

/**
 * Get transfer deadline for an event.
 */
export async function getTransferDeadline(
  eventId: string,
  ticketTypeId?: string,
  db?: DbAdapter,
): Promise<TransferDeadline | null> {
  let query = `SELECT * FROM transfers.transfer_deadlines
     WHERE event_id = $1`;
  const params: unknown[] = [eventId];

  if (ticketTypeId) {
    query += ` AND (ticket_type_id = $2 OR ticket_type_id IS NULL)
     ORDER BY ticket_type_id DESC`;
    params.push(ticketTypeId);
  }

  const rows = await (db || { query: async () => [] } as DbAdapter).query<TransferDeadlineRow>(
    query,
    params,
  );

  return rows[0] ? mapTransferDeadline(rows[0]) : null;
}

/**
 * Disable all transfers for an event.
 */
export async function disableTransfers(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE transfers.transfer_deadlines
     SET allow_transfers = false, updated_at = NOW()
     WHERE event_id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
}

/**
 * Enable transfers for an event.
 */
export async function enableTransfers(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE transfers.transfer_deadlines
     SET allow_transfers = true, updated_at = NOW()
     WHERE event_id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
}
