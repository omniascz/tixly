// =============================================================================
// Accessibility Management — Companion Tickets & Accessible Seating
// Feature #32: EU regulatory requirement for disabled attendee support
// =============================================================================

export interface CompanionPair {
  id: string;
  primaryTicketId: string;
  companionTicketId: string;
  relationshipType: 'assistant' | 'carer' | 'support_person' | 'guide';
  createdAt: string;
}

export interface AccessibleSeat {
  id: string;
  eventId: string;
  promoterId: string;
  seatId: string;
  seatSection?: string;
  accessibilityType: string;
  isAvailable: boolean;
  reservedUntil?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Accommodation {
  id: string;
  ticketId: string;
  accommodationType: string;
  additionalInfo?: string;
  verified: boolean;
  verifiedAt?: string;
  createdAt: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface CompanionPairRow {
  id: string;
  primary_ticket_id: string;
  companion_ticket_id: string;
  relationship_type: string;
  created_at: string;
}

interface AccessibleSeatRow {
  id: string;
  event_id: string;
  promoter_id: string;
  seat_id: string;
  seat_section: string | null;
  accessibility_type: string;
  is_available: boolean;
  reserved_until: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface AccommodationRow {
  id: string;
  ticket_id: string;
  accommodation_type: string;
  additional_info: string | null;
  verified: boolean;
  verified_at: string | null;
  created_at: string;
}

function mapCompanionPair(row: CompanionPairRow): CompanionPair {
  return {
    id: row.id,
    primaryTicketId: row.primary_ticket_id,
    companionTicketId: row.companion_ticket_id,
    relationshipType: row.relationship_type as any,
    createdAt: row.created_at,
  };
}

function mapAccessibleSeat(row: AccessibleSeatRow): AccessibleSeat {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    seatId: row.seat_id,
    seatSection: row.seat_section || undefined,
    accessibilityType: row.accessibility_type,
    isAvailable: row.is_available,
    reservedUntil: row.reserved_until || undefined,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAccommodation(row: AccommodationRow): Accommodation {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    accommodationType: row.accommodation_type,
    additionalInfo: row.additional_info || undefined,
    verified: row.verified,
    verifiedAt: row.verified_at || undefined,
    createdAt: row.created_at,
  };
}

/**
 * Create a companion ticket pair (primary + free companion).
 * Transactional to ensure both tickets are properly linked.
 */
export async function createCompanionPair(
  primaryTicketId: string,
  companionTicketId: string,
  relationshipType: 'assistant' | 'carer' | 'support_person' | 'guide',
  db: DbAdapter,
): Promise<CompanionPair> {
  if (!primaryTicketId || !companionTicketId) {
    throw new Error('VALIDATION_ERROR: both ticket IDs required');
  }

  const rows = await db.query<CompanionPairRow>(
    `INSERT INTO accessibility.companion_pairs
       (primary_ticket_id, companion_ticket_id, relationship_type)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [primaryTicketId, companionTicketId, relationshipType],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: companion pair creation failed');
  return mapCompanionPair(rows[0]);
}

/**
 * Get the companion ticket for a primary ticket (if paired).
 */
export async function getCompanionTicket(
  primaryTicketId: string,
  db: DbAdapter,
): Promise<CompanionPair | null> {
  const rows = await db.query<CompanionPairRow>(
    `SELECT * FROM accessibility.companion_pairs
     WHERE primary_ticket_id = $1`,
    [primaryTicketId],
  );
  return rows[0] ? mapCompanionPair(rows[0]) : null;
}

/**
 * Mark a seat as accessible (tenant-scoped).
 * Upserts on (event_id, seat_id, accessibility_type) conflict.
 */
export async function markSeatAccessible(
  eventId: string,
  promoterId: string,
  seatId: string,
  accessibilityType: string,
  notes?: string,
  db?: DbAdapter,
): Promise<AccessibleSeat> {
  if (!seatId) {
    throw new Error('VALIDATION_ERROR: seatId required');
  }

  const rows = await (db || { query: async () => [] } as DbAdapter).query<AccessibleSeatRow>(
    `INSERT INTO accessibility.accessible_seats
       (event_id, promoter_id, seat_id, accessibility_type, notes, is_available)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (event_id, seat_id, accessibility_type)
     DO UPDATE SET
       is_available = true,
       notes = COALESCE($5, notes),
       updated_at = NOW()
     RETURNING *`,
    [eventId, promoterId, seatId, accessibilityType, notes || null],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: seat marking failed');
  return mapAccessibleSeat(rows[0]);
}

/**
 * Get all accessible seats for an event (tenant-scoped).
 */
export async function getAccessibleSeats(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
  accessibilityType?: string,
): Promise<AccessibleSeat[]> {
  let query = `SELECT * FROM accessibility.accessible_seats
     WHERE event_id = $1 AND promoter_id = $2`;
  const params: unknown[] = [eventId, promoterId];

  if (accessibilityType) {
    query += ` AND accessibility_type = $3`;
    params.push(accessibilityType);
  }

  query += ` ORDER BY seat_id ASC`;

  const rows = await db.query<AccessibleSeatRow>(query, params);
  return rows.map(mapAccessibleSeat);
}

/**
 * Request an accessibility accommodation at checkout.
 */
export async function requestAccommodation(
  ticketId: string,
  accommodationType: string,
  additionalInfo?: string,
  db?: DbAdapter,
): Promise<Accommodation> {
  if (!accommodationType) {
    throw new Error('VALIDATION_ERROR: accommodationType required');
  }

  const rows = await (db || { query: async () => [] } as DbAdapter).query<AccommodationRow>(
    `INSERT INTO accessibility.accommodations
       (ticket_id, accommodation_type, additional_info)
     VALUES ($1, $2, $3)
     ON CONFLICT (ticket_id, accommodation_type)
     DO UPDATE SET additional_info = COALESCE($3, additional_info)
     RETURNING *`,
    [ticketId, accommodationType, additionalInfo || null],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: accommodation request failed');
  return mapAccommodation(rows[0]);
}

/**
 * Get all accommodations for a ticket.
 */
export async function getTicketAccommodations(
  ticketId: string,
  db: DbAdapter,
): Promise<Accommodation[]> {
  const rows = await db.query<AccommodationRow>(
    `SELECT * FROM accessibility.accommodations WHERE ticket_id = $1`,
    [ticketId],
  );
  return rows.map(mapAccommodation);
}

/**
 * Verify an accommodation (staff/admin operation).
 */
export async function verifyAccommodation(
  accommodationId: string,
  db: DbAdapter,
): Promise<Accommodation> {
  const rows = await db.query<AccommodationRow>(
    `UPDATE accessibility.accommodations
     SET verified = true, verified_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [accommodationId],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: accommodation not found');
  return mapAccommodation(rows[0]);
}

/**
 * Reserve an accessible seat (mark as unavailable until date).
 */
export async function reserveAccessibleSeat(
  seatId: string,
  eventId: string,
  reservedUntil: Date,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE accessibility.accessible_seats
     SET is_available = false, reserved_until = $1
     WHERE event_id = $2 AND seat_id = $3`,
    [reservedUntil, eventId, seatId],
  );
}

/**
 * Release a reserved accessible seat.
 */
export async function releaseAccessibleSeat(
  seatId: string,
  eventId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE accessibility.accessible_seats
     SET is_available = true, reserved_until = NULL
     WHERE event_id = $1 AND seat_id = $2`,
    [eventId, seatId],
  );
}
