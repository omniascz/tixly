// =============================================================================
// Pre-Entry Validation Service — Dry-Run Ticket Checks
// Feature #36: Validate tickets before gates open without logging to scan log
// =============================================================================

export interface ValidationError {
  code: string;
  message: string;
}

export interface ValidationResult {
  ticketId: string;
  isValid: boolean;
  error?: ValidationError;
}

export interface BatchCheckResult {
  id: string;
  eventId: string;
  totalChecked: number;
  validCount: number;
  invalidCount: number;
  durationMs: number;
  results: ValidationResult[];
}

export interface EventEntryMode {
  id: string;
  eventId: string;
  promoterId: string;
  preEntryMode: boolean;
  preEntryStart?: string;
  preEntryEnd?: string;
  allowBatchCheck: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PreEntryCheck {
  id: string;
  eventId: string;
  ticketId: string;
  isValid: boolean;
  validationError?: string;
  staffEmail?: string;
  checkedAt: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface PreEntryCheckRow {
  id: string;
  event_id: string;
  ticket_id: string;
  is_valid: boolean;
  validation_error: string | null;
  staff_email: string | null;
  checked_at: string;
}

interface EventEntryModeRow {
  id: string;
  event_id: string;
  promoter_id: string;
  pre_entry_mode: boolean;
  pre_entry_start: string | null;
  pre_entry_end: string | null;
  allow_batch_check: boolean;
  created_at: string;
  updated_at: string;
}

interface BatchCheckRow {
  id: string;
  event_id: string;
  staff_email: string;
  total_checked: number;
  valid_count: number;
  invalid_count: number;
  checked_at: string;
  batch_duration_ms: number | null;
}

function mapPreEntryCheck(row: PreEntryCheckRow): PreEntryCheck {
  return {
    id: row.id,
    eventId: row.event_id,
    ticketId: row.ticket_id,
    isValid: row.is_valid,
    validationError: row.validation_error || undefined,
    staffEmail: row.staff_email || undefined,
    checkedAt: row.checked_at,
  };
}

function mapEventEntryMode(row: EventEntryModeRow): EventEntryMode {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    preEntryMode: row.pre_entry_mode,
    preEntryStart: row.pre_entry_start || undefined,
    preEntryEnd: row.pre_entry_end || undefined,
    allowBatchCheck: row.allow_batch_check,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validate a ticket without logging to scan log (dry-run).
 * Only writes to pre_entry_checks table for audit.
 */
export async function validateTicketDryRun(
  eventId: string,
  ticketId: string,
  staffEmail: string,
  db: DbAdapter,
): Promise<PreEntryCheck> {
  // Check ticket exists and its status
  const ticketRows = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM tickets.tickets
     WHERE id = $1 AND event_id = $2`,
    [ticketId, eventId],
  );

  let isValid = false;
  let validationError: string | null = null;

  if (!ticketRows[0]) {
    validationError = 'TICKET_NOT_FOUND';
  } else if (ticketRows[0].status === 'refunded') {
    validationError = 'TICKET_REFUNDED';
  } else if (ticketRows[0].status === 'revoked') {
    validationError = 'TICKET_REVOKED';
  } else if (ticketRows[0].status === 'transferred') {
    validationError = 'TICKET_TRANSFERRED';
  } else if (ticketRows[0].status === 'valid') {
    isValid = true;
  }

  // Log this dry-run check
  const rows = await db.query<PreEntryCheckRow>(
    `INSERT INTO validation.pre_entry_checks
       (event_id, ticket_id, is_valid, validation_error, staff_email)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [eventId, ticketId, isValid, validationError, staffEmail],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: dry-run check failed');
  return mapPreEntryCheck(rows[0]);
}

/**
 * Get validation errors for a ticket without logging.
 * Used for showing validation issues to staff.
 */
export async function getValidationErrors(
  eventId: string,
  ticketId: string,
  db: DbAdapter,
): Promise<ValidationError | null> {
  const ticketRows = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM tickets.tickets
     WHERE id = $1 AND event_id = $2`,
    [ticketId, eventId],
  );

  if (!ticketRows[0]) {
    return {
      code: 'TICKET_NOT_FOUND',
      message: 'Ticket was not found in this event',
    };
  }

  const status = ticketRows[0].status;
  const errors: { [key: string]: string } = {
    refunded: 'Ticket has been refunded',
    revoked: 'Ticket has been revoked',
    transferred: 'Ticket has been transferred',
    invalid: 'Ticket is invalid',
  };

  if (errors[status]) {
    return {
      code: status.toUpperCase(),
      message: errors[status],
    };
  }

  return null;  // No errors
}

/**
 * Enable pre-entry check mode for an event.
 */
export async function enablePreEntryMode(
  eventId: string,
  promoterId: string,
  preEntryStart: Date,
  preEntryEnd: Date,
  db: DbAdapter,
): Promise<EventEntryMode> {
  const rows = await db.query<EventEntryModeRow>(
    `INSERT INTO validation.event_entry_modes
       (event_id, promoter_id, pre_entry_mode, pre_entry_start, pre_entry_end)
     VALUES ($1, $2, true, $3, $4)
     ON CONFLICT (event_id)
     DO UPDATE SET
       pre_entry_mode = true,
       pre_entry_start = $3,
       pre_entry_end = $4,
       updated_at = NOW()
     RETURNING *`,
    [eventId, promoterId, preEntryStart, preEntryEnd],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: pre-entry mode enable failed');
  return mapEventEntryMode(rows[0]);
}

/**
 * Disable pre-entry check mode for an event.
 */
export async function disablePreEntryMode(
  eventId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE validation.event_entry_modes
     SET pre_entry_mode = false, updated_at = NOW()
     WHERE event_id = $1`,
    [eventId],
  );
}

/**
 * Check if an event is in pre-entry mode.
 */
export async function isEventInPreEntryMode(
  eventId: string,
  db: DbAdapter,
): Promise<boolean> {
  const rows = await db.query<{ pre_entry_mode: boolean }>(
    `SELECT pre_entry_mode FROM validation.event_entry_modes
     WHERE event_id = $1`,
    [eventId],
  );
  return rows[0]?.pre_entry_mode ?? false;
}

/**
 * Batch validate multiple tickets (dry-run).
 */
export async function batchValidateTickets(
  eventId: string,
  ticketIds: string[],
  staffEmail: string,
  db: DbAdapter,
): Promise<BatchCheckResult> {
  if (ticketIds.length === 0) {
    throw new Error('VALIDATION_ERROR: at least one ticket required');
  }

  const startTime = Date.now();
  const results: ValidationResult[] = [];

  for (const ticketId of ticketIds) {
    const check = await validateTicketDryRun(eventId, ticketId, staffEmail, db);
    results.push({
      ticketId,
      isValid: check.isValid,
      error: check.validationError
        ? { code: check.validationError, message: check.validationError }
        : undefined,
    });
  }

  const durationMs = Date.now() - startTime;
  const validCount = results.filter((r) => r.isValid).length;
  const invalidCount = results.filter((r) => !r.isValid).length;

  // Log batch check
  const batchRows = await db.query<{ id: string }>(
    `INSERT INTO validation.batch_checks
       (event_id, staff_email, total_checked, valid_count, invalid_count, batch_duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [eventId, staffEmail, ticketIds.length, validCount, invalidCount, durationMs],
  );

  if (!batchRows[0]) throw new Error('INTERNAL_ERROR: batch check failed');

  return {
    id: batchRows[0].id,
    eventId,
    totalChecked: ticketIds.length,
    validCount,
    invalidCount,
    durationMs,
    results,
  };
}

/**
 * Get pre-entry checks for an event.
 */
export async function getPreEntryChecks(
  eventId: string,
  limit: number = 100,
  offset: number = 0,
  db: DbAdapter,
): Promise<PreEntryCheck[]> {
  const rows = await db.query<PreEntryCheckRow>(
    `SELECT * FROM validation.pre_entry_checks
     WHERE event_id = $1
     ORDER BY checked_at DESC
     LIMIT $2 OFFSET $3`,
    [eventId, limit, offset],
  );
  return rows.map(mapPreEntryCheck);
}
