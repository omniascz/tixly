// =============================================================================
// Event Ticket Defaults Service
// Feature #177: Promoter sets event-level defaults applied to new ticket types
//
// Promoter sets once per event:
//   - Age restriction (18+)
//   - Max tickets per order
//   - Message when ticket is inactive
//   - Whether transfer / resale is allowed by default
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface EventTicketDefaults {
  eventId: string;
  promoterId: string;
  minAge: number | null;
  maxPerOrder: number | null;
  inactiveMessage: string | null;
  saleStartOffsetMinutes: number | null;
  saleEndOffsetMinutes: number | null;
  requireName: boolean;
  requireDob: boolean;
  transferAllowed: boolean;
  resaleAllowed: boolean;
  updatedAt: string;
}

interface DefaultsRow {
  event_id: string;
  promoter_id: string;
  min_age: number | null;
  max_per_order: number | null;
  inactive_message: string | null;
  sale_start_offset_minutes: number | null;
  sale_end_offset_minutes: number | null;
  require_name: boolean;
  require_dob: boolean;
  transfer_allowed: boolean;
  resale_allowed: boolean;
  updated_at: string;
}

function mapDefaults(r: DefaultsRow): EventTicketDefaults {
  return {
    eventId: r.event_id,
    promoterId: r.promoter_id,
    minAge: r.min_age,
    maxPerOrder: r.max_per_order,
    inactiveMessage: r.inactive_message,
    saleStartOffsetMinutes: r.sale_start_offset_minutes,
    saleEndOffsetMinutes: r.sale_end_offset_minutes,
    requireName: r.require_name,
    requireDob: r.require_dob,
    transferAllowed: r.transfer_allowed,
    resaleAllowed: r.resale_allowed,
    updatedAt: r.updated_at,
  };
}

/**
 * Set (upsert) default ticket settings for an event.
 */
export async function setEventTicketDefaults(
  input: {
    eventId: string;
    promoterId: string;
    minAge?: number | null;
    maxPerOrder?: number | null;
    inactiveMessage?: string | null;
    saleStartOffsetMinutes?: number | null;
    saleEndOffsetMinutes?: number | null;
    requireName?: boolean;
    requireDob?: boolean;
    transferAllowed?: boolean;
    resaleAllowed?: boolean;
  },
  db: DbAdapter,
): Promise<EventTicketDefaults> {
  if (input.minAge !== undefined && input.minAge !== null) {
    if (input.minAge < 0 || input.minAge > 120) {
      throw new Error('VALIDATION_ERROR: minAge must be between 0 and 120');
    }
  }
  if (input.maxPerOrder !== undefined && input.maxPerOrder !== null) {
    if (input.maxPerOrder < 1) {
      throw new Error('VALIDATION_ERROR: maxPerOrder must be >= 1');
    }
  }

  const rows = await db.query<DefaultsRow>(
    `INSERT INTO catalog.event_ticket_defaults
       (event_id, promoter_id, min_age, max_per_order, inactive_message,
        sale_start_offset_minutes, sale_end_offset_minutes,
        require_name, require_dob, transfer_allowed, resale_allowed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (event_id) DO UPDATE SET
       min_age = EXCLUDED.min_age,
       max_per_order = EXCLUDED.max_per_order,
       inactive_message = EXCLUDED.inactive_message,
       sale_start_offset_minutes = EXCLUDED.sale_start_offset_minutes,
       sale_end_offset_minutes = EXCLUDED.sale_end_offset_minutes,
       require_name = EXCLUDED.require_name,
       require_dob = EXCLUDED.require_dob,
       transfer_allowed = EXCLUDED.transfer_allowed,
       resale_allowed = EXCLUDED.resale_allowed,
       updated_at = NOW()
     RETURNING *`,
    [
      input.eventId,
      input.promoterId,
      input.minAge ?? null,
      input.maxPerOrder ?? null,
      input.inactiveMessage ?? null,
      input.saleStartOffsetMinutes ?? null,
      input.saleEndOffsetMinutes ?? null,
      input.requireName ?? false,
      input.requireDob ?? false,
      input.transferAllowed ?? true,
      input.resaleAllowed ?? true,
    ],
  );

  return mapDefaults(rows[0]);
}

/**
 * Get event ticket defaults. Returns null if not configured.
 */
export async function getEventTicketDefaults(
  eventId: string,
  db: DbAdapter,
): Promise<EventTicketDefaults | null> {
  const rows = await db.query<DefaultsRow>(
    `SELECT * FROM catalog.event_ticket_defaults WHERE event_id = $1`,
    [eventId],
  );
  return rows[0] ? mapDefaults(rows[0]) : null;
}

/**
 * Apply event defaults to a new ticket type input.
 * Fills in undefined fields from the event defaults.
 */
export function applyDefaults<T extends Record<string, unknown>>(
  ticketTypeInput: T,
  defaults: EventTicketDefaults | null,
): T {
  if (!defaults) return ticketTypeInput;

  return {
    minAge: defaults.minAge,
    maxPerOrder: defaults.maxPerOrder,
    inactiveMessage: defaults.inactiveMessage,
    transferAllowed: defaults.transferAllowed,
    resaleAllowed: defaults.resaleAllowed,
    requireName: defaults.requireName,
    requireDob: defaults.requireDob,
    ...ticketTypeInput, // explicit fields win over defaults
  } as T;
}

/**
 * Delete event defaults (reset to system defaults).
 */
export async function deleteEventTicketDefaults(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `DELETE FROM catalog.event_ticket_defaults WHERE event_id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
}
