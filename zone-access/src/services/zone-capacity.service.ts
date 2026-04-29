// =============================================================================
// Zone Capacity Service — Multi-Zone Real-Time Occupancy Tracking
// Feature #192: Track who's inside each zone, enforce capacity limits, log passages
//
// Extends the existing zone-access module which handles gate-based access control.
// This service adds:
//   - Real-time occupancy count per zone (atomic increment/decrement)
//   - Entry/exit passage log for audit and statistics
//   - Per-ticket zone overrides (custom zones beyond ticket-type defaults)
//   - Capacity enforcement: deny entry if zone is at capacity
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface ZoneOccupancy {
  zoneId: string;
  eventId: string;
  currentCount: number;
  maxCapacity: number | null;
  isFull: boolean;
  lastUpdatedAt: string;
}

export interface ZonePassage {
  id: string;
  ticketId: string;
  zoneId: string;
  eventId: string;
  direction: 'entry' | 'exit';
  gateId: string;
  staffId: string | null;
  scannedAt: string;
}

export interface ZoneOverride {
  ticketId: string;
  zoneId: string;
  eventId: string;
  grantedBy: string;
  grantedAt: string;
  expiresAt: string | null;
}

interface OccupancyRow {
  zone_id: string;
  event_id: string;
  current_count: number;
  max_capacity: number | null;
  last_updated_at: string;
}

interface PassageRow {
  id: string;
  ticket_id: string;
  zone_id: string;
  event_id: string;
  direction: string;
  gate_id: string;
  staff_id: string | null;
  scanned_at: string;
}

function mapOccupancy(r: OccupancyRow): ZoneOccupancy {
  return {
    zoneId: r.zone_id,
    eventId: r.event_id,
    currentCount: r.current_count,
    maxCapacity: r.max_capacity,
    isFull: r.max_capacity !== null && r.current_count >= r.max_capacity,
    lastUpdatedAt: r.last_updated_at,
  };
}

function mapPassage(r: PassageRow): ZonePassage {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    zoneId: r.zone_id,
    eventId: r.event_id,
    direction: r.direction as ZonePassage['direction'],
    gateId: r.gate_id,
    staffId: r.staff_id,
    scannedAt: r.scanned_at,
  };
}

/**
 * Initialize zone occupancy tracking for an event's zones.
 * Call once when event opens gates.
 */
export async function initZoneOccupancy(
  eventId: string,
  zones: Array<{ zoneId: string; maxCapacity: number | null }>,
  db: DbAdapter,
): Promise<ZoneOccupancy[]> {
  const results: ZoneOccupancy[] = [];

  for (const zone of zones) {
    const rows = await db.query<OccupancyRow>(
      `INSERT INTO zone_access.zone_occupancy (zone_id, event_id, max_capacity)
       VALUES ($1, $2, $3)
       ON CONFLICT (zone_id, event_id) DO UPDATE SET
         max_capacity = EXCLUDED.max_capacity,
         last_updated_at = NOW()
       RETURNING *`,
      [zone.zoneId, eventId, zone.maxCapacity],
    );
    if (rows[0]) results.push(mapOccupancy(rows[0]));
  }

  return results;
}

/**
 * Record an entry into a zone. Atomically increments the occupancy counter.
 * Returns null if zone is at capacity (entry denied).
 */
export async function recordEntry(
  ticketId: string,
  zoneId: string,
  eventId: string,
  gateId: string,
  staffId: string | null,
  db: DbAdapter,
): Promise<{ passage: ZonePassage; occupancy: ZoneOccupancy } | null> {
  // Atomic increment — only if below capacity
  const occupancyRows = await db.query<OccupancyRow>(
    `UPDATE zone_access.zone_occupancy
     SET current_count = current_count + 1,
         last_updated_at = NOW()
     WHERE zone_id = $1
       AND event_id = $2
       AND (max_capacity IS NULL OR current_count < max_capacity)
     RETURNING *`,
    [zoneId, eventId],
  );

  if (!occupancyRows[0]) {
    // Zone at capacity or not initialized
    return null;
  }

  const passageRows = await db.query<PassageRow>(
    `INSERT INTO zone_access.zone_passage_log (ticket_id, zone_id, event_id, direction, gate_id, staff_id)
     VALUES ($1, $2, $3, 'entry', $4, $5)
     RETURNING *`,
    [ticketId, zoneId, eventId, gateId, staffId],
  );

  return {
    passage: mapPassage(passageRows[0]),
    occupancy: mapOccupancy(occupancyRows[0]),
  };
}

/**
 * Record an exit from a zone. Atomically decrements the counter.
 */
export async function recordExit(
  ticketId: string,
  zoneId: string,
  eventId: string,
  gateId: string,
  staffId: string | null,
  db: DbAdapter,
): Promise<ZonePassage> {
  await db.execute(
    `UPDATE zone_access.zone_occupancy
     SET current_count = GREATEST(current_count - 1, 0),
         last_updated_at = NOW()
     WHERE zone_id = $1 AND event_id = $2`,
    [zoneId, eventId],
  );

  const passageRows = await db.query<PassageRow>(
    `INSERT INTO zone_access.zone_passage_log (ticket_id, zone_id, event_id, direction, gate_id, staff_id)
     VALUES ($1, $2, $3, 'exit', $4, $5)
     RETURNING *`,
    [ticketId, zoneId, eventId, gateId, staffId],
  );

  return mapPassage(passageRows[0]);
}

/**
 * Get current occupancy for all zones in an event.
 */
export async function getEventOccupancy(
  eventId: string,
  db: DbAdapter,
): Promise<ZoneOccupancy[]> {
  const rows = await db.query<OccupancyRow>(
    `SELECT * FROM zone_access.zone_occupancy WHERE event_id = $1 ORDER BY zone_id ASC`,
    [eventId],
  );
  return rows.map(mapOccupancy);
}

/**
 * Get occupancy for a specific zone.
 */
export async function getZoneOccupancy(
  zoneId: string,
  eventId: string,
  db: DbAdapter,
): Promise<ZoneOccupancy | null> {
  const rows = await db.query<OccupancyRow>(
    `SELECT * FROM zone_access.zone_occupancy WHERE zone_id = $1 AND event_id = $2`,
    [zoneId, eventId],
  );
  return rows[0] ? mapOccupancy(rows[0]) : null;
}

/**
 * Grant a ticket custom zone access (override ticket-type defaults).
 * Used for special tickets: media, VIP upgrades, etc.
 */
export async function grantZoneOverride(
  ticketId: string,
  zoneId: string,
  eventId: string,
  grantedBy: string,
  expiresAt: string | null,
  db: DbAdapter,
): Promise<ZoneOverride> {
  const rows = await db.query<{
    ticket_id: string;
    zone_id: string;
    event_id: string;
    granted_by: string;
    granted_at: string;
    expires_at: string | null;
  }>(
    `INSERT INTO zone_access.ticket_zone_overrides (ticket_id, zone_id, event_id, granted_by, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (ticket_id, zone_id) DO UPDATE SET
       granted_by = EXCLUDED.granted_by,
       granted_at = NOW(),
       expires_at = EXCLUDED.expires_at
     RETURNING *`,
    [ticketId, zoneId, eventId, grantedBy, expiresAt],
  );

  const r = rows[0];
  return {
    ticketId: r.ticket_id,
    zoneId: r.zone_id,
    eventId: r.event_id,
    grantedBy: r.granted_by,
    grantedAt: r.granted_at,
    expiresAt: r.expires_at,
  };
}

/**
 * Get passage history for a ticket (how many zones, when).
 */
export async function getTicketPassages(
  ticketId: string,
  db: DbAdapter,
): Promise<ZonePassage[]> {
  const rows = await db.query<PassageRow>(
    `SELECT * FROM zone_access.zone_passage_log WHERE ticket_id = $1 ORDER BY scanned_at ASC`,
    [ticketId],
  );
  return rows.map(mapPassage);
}

/**
 * Get zone passage statistics for reporting.
 */
export async function getZoneStats(
  eventId: string,
  db: DbAdapter,
): Promise<Array<{ zoneId: string; entries: number; exits: number; currentInside: number }>> {
  const rows = await db.query<{
    zone_id: string;
    entries: string;
    exits: string;
  }>(
    `SELECT
       zone_id,
       COUNT(*) FILTER (WHERE direction = 'entry') AS entries,
       COUNT(*) FILTER (WHERE direction = 'exit') AS exits
     FROM zone_access.zone_passage_log
     WHERE event_id = $1
     GROUP BY zone_id`,
    [eventId],
  );

  return rows.map((r) => ({
    zoneId: r.zone_id,
    entries: Number(r.entries),
    exits: Number(r.exits),
    currentInside: Number(r.entries) - Number(r.exits),
  }));
}
