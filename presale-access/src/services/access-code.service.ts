// =============================================================================
// Access Code Service — Hidden Tickets / Access Code Tickets
// Feature #160: Ticket types unlocked via secret code or link
//
// Visibility modes:
//   public      — visible to all (default)
//   hidden      — never shown in catalog; must know direct URL
//   access_code — shown only after valid code entered at checkout
// =============================================================================

import { randomBytes } from 'crypto';

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface AccessCode {
  id: string;
  eventId: string;
  promoterId: string;
  code: string;
  label: string | null;
  maxUses: number | null;
  usesCount: number;
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string;
}

export interface AccessCodeWithTicketTypes extends AccessCode {
  ticketTypeIds: string[];
}

interface AccessCodeRow {
  id: string;
  event_id: string;
  promoter_id: string;
  code: string;
  label: string | null;
  max_uses: number | null;
  uses_count: number;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
}

function mapAccessCode(r: AccessCodeRow): AccessCode {
  return {
    id: r.id,
    eventId: r.event_id,
    promoterId: r.promoter_id,
    code: r.code,
    label: r.label,
    maxUses: r.max_uses,
    usesCount: r.uses_count,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    createdAt: r.created_at,
  };
}

/**
 * Create an access code that unlocks specific hidden ticket types.
 */
export async function createAccessCode(
  input: {
    eventId: string;
    promoterId: string;
    ticketTypeIds: string[];
    label?: string;
    maxUses?: number;
    validFrom?: string;
    validUntil?: string;
    customCode?: string;
  },
  db: DbAdapter,
): Promise<AccessCodeWithTicketTypes> {
  if (input.ticketTypeIds.length === 0) {
    throw new Error('VALIDATION_ERROR: at least one ticketTypeId is required');
  }

  const code = input.customCode?.toUpperCase().trim() || randomBytes(5).toString('hex').toUpperCase();

  const rows = await db.query<AccessCodeRow>(
    `INSERT INTO catalog.access_codes
       (event_id, promoter_id, code, label, max_uses, valid_from, valid_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.eventId,
      input.promoterId,
      code,
      input.label ?? null,
      input.maxUses ?? null,
      input.validFrom ?? null,
      input.validUntil ?? null,
    ],
  );

  const accessCode = rows[0];

  // Link ticket types
  for (const ttId of input.ticketTypeIds) {
    await db.execute(
      `INSERT INTO catalog.access_code_ticket_types (access_code_id, ticket_type_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [accessCode.id, ttId],
    );
  }

  return { ...mapAccessCode(accessCode), ticketTypeIds: input.ticketTypeIds };
}

/**
 * Validate and redeem an access code at checkout.
 * Returns the list of ticket type IDs the code unlocks.
 * Atomically increments uses_count.
 */
export async function redeemAccessCode(
  eventId: string,
  code: string,
  db: DbAdapter,
): Promise<{ ticketTypeIds: string[]; accessCodeId: string }> {
  // Atomically increment uses_count — only if valid and under limit
  const rows = await db.query<AccessCodeRow>(
    `UPDATE catalog.access_codes
     SET uses_count = uses_count + 1
     WHERE event_id = $1
       AND code = UPPER($2)
       AND (max_uses IS NULL OR uses_count < max_uses)
       AND (valid_from IS NULL OR valid_from <= NOW())
       AND (valid_until IS NULL OR valid_until >= NOW())
     RETURNING *`,
    [eventId, code],
  );

  if (!rows[0]) throw new Error('ACCESS_CODE_INVALID_OR_EXHAUSTED');

  const accessCode = rows[0];

  const ttRows = await db.query<{ ticket_type_id: string }>(
    `SELECT ticket_type_id FROM catalog.access_code_ticket_types WHERE access_code_id = $1`,
    [accessCode.id],
  );

  return {
    ticketTypeIds: ttRows.map((r) => r.ticket_type_id),
    accessCodeId: accessCode.id,
  };
}

/**
 * List access codes for an event (promoter view).
 */
export async function listAccessCodes(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<AccessCodeWithTicketTypes[]> {
  const rows = await db.query<AccessCodeRow>(
    `SELECT * FROM catalog.access_codes
     WHERE event_id = $1 AND promoter_id = $2
     ORDER BY created_at DESC`,
    [eventId, promoterId],
  );

  const results: AccessCodeWithTicketTypes[] = [];
  for (const row of rows) {
    const ttRows = await db.query<{ ticket_type_id: string }>(
      `SELECT ticket_type_id FROM catalog.access_code_ticket_types WHERE access_code_id = $1`,
      [row.id],
    );
    results.push({ ...mapAccessCode(row), ticketTypeIds: ttRows.map((r) => r.ticket_type_id) });
  }
  return results;
}

/**
 * Set the visibility of a ticket type (public / hidden / access_code).
 */
export async function setTicketTypeVisibility(
  ticketTypeId: string,
  promoterId: string,
  visibility: 'public' | 'hidden' | 'access_code',
  db: DbAdapter,
): Promise<void> {
  const rows = await db.query<{ id: string }>(
    `UPDATE catalog.ticket_types tt
     SET visibility = $2
     FROM catalog.events e
     WHERE tt.id = $1
       AND tt.event_id = e.id
       AND e.promoter_id = $3
     RETURNING tt.id`,
    [ticketTypeId, visibility, promoterId],
  );
  if (!rows[0]) throw new Error('TICKET_TYPE_NOT_FOUND');
}
