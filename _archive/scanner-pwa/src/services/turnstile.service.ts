// =============================================================================
// Turnstile Service — Physical Gate Integration
// Feature #187: API for physical turnstiles at large venues/festivals
//
// Turnstiles send HTTP requests to this service for real-time validation.
// Response tells the turnstile: open/deny + how long to hold open.
//
// Throughput: designed for 1000s of entries/hour per gate.
// Latency: target < 200ms total (DB read + response).
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface TurnstileDevice {
  id: string;
  eventId: string;
  venueId: string;
  deviceId: string;
  name: string;
  zoneId: string | null;
  gateType: 'entry' | 'exit' | 'bidirectional';
  status: 'online' | 'offline' | 'error' | 'maintenance';
  lastHeartbeatAt: string | null;
  firmwareVersion: string | null;
  createdAt: string;
}

export interface TurnstilePassage {
  id: string;
  deviceId: string;
  ticketId: string | null;
  qrPayload: string;
  direction: 'entry' | 'exit';
  result: 'granted' | 'denied' | 'error';
  denyReason: string | null;
  gateOpenMs: number | null;
  latencyMs: number | null;
  processedAt: string;
}

export interface TurnstileValidationResult {
  result: 'granted' | 'denied' | 'error';
  gateOpenMs: number;
  denyReason: string | null;
  ticketId: string | null;
  holderName: string | null;
  passageId: string;
}

export interface CapacityStatus {
  deviceId: string;
  eventId: string;
  entriesCount: number;
  exitsCount: number;
  currentInside: number;
  lastPassageAt: string | null;
}

interface DeviceRow {
  id: string;
  event_id: string;
  venue_id: string;
  device_id: string;
  name: string;
  zone_id: string | null;
  gate_type: string;
  status: string;
  last_heartbeat_at: string | null;
  firmware_version: string | null;
  created_at: string;
}

interface PassageRow {
  id: string;
  device_id: string;
  ticket_id: string | null;
  qr_payload: string;
  direction: string;
  result: string;
  deny_reason: string | null;
  gate_open_ms: number | null;
  latency_ms: number | null;
  processed_at: string;
}

interface CounterRow {
  device_id: string;
  event_id: string;
  entries_count: number;
  exits_count: number;
  current_inside: number;
  last_passage_at: string | null;
}

function mapDevice(r: DeviceRow): TurnstileDevice {
  return {
    id: r.id,
    eventId: r.event_id,
    venueId: r.venue_id,
    deviceId: r.device_id,
    name: r.name,
    zoneId: r.zone_id,
    gateType: r.gate_type as TurnstileDevice['gateType'],
    status: r.status as TurnstileDevice['status'],
    lastHeartbeatAt: r.last_heartbeat_at,
    firmwareVersion: r.firmware_version,
    createdAt: r.created_at,
  };
}

function mapPassage(r: PassageRow): TurnstilePassage {
  return {
    id: r.id,
    deviceId: r.device_id,
    ticketId: r.ticket_id,
    qrPayload: r.qr_payload,
    direction: r.direction as TurnstilePassage['direction'],
    result: r.result as TurnstilePassage['result'],
    denyReason: r.deny_reason,
    gateOpenMs: r.gate_open_ms,
    latencyMs: r.latency_ms,
    processedAt: r.processed_at,
  };
}

const DEFAULT_GATE_OPEN_MS = 3000; // 3 seconds open for passage

/**
 * Register a new turnstile device.
 */
export async function registerDevice(
  input: {
    eventId: string;
    venueId: string;
    deviceId: string;
    name: string;
    zoneId?: string;
    gateType?: TurnstileDevice['gateType'];
    firmwareVersion?: string;
  },
  db: DbAdapter,
): Promise<TurnstileDevice> {
  if (!input.deviceId.trim()) throw new Error('VALIDATION_ERROR: deviceId is required');

  const rows = await db.query<DeviceRow>(
    `INSERT INTO turnstiles.turnstile_devices
       (event_id, venue_id, device_id, name, zone_id, gate_type, firmware_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (device_id) DO UPDATE SET
       name = EXCLUDED.name,
       zone_id = EXCLUDED.zone_id,
       gate_type = EXCLUDED.gate_type,
       firmware_version = EXCLUDED.firmware_version
     RETURNING *`,
    [
      input.eventId,
      input.venueId,
      input.deviceId,
      input.name,
      input.zoneId ?? null,
      input.gateType ?? 'entry',
      input.firmwareVersion ?? null,
    ],
  );

  return mapDevice(rows[0]);
}

/**
 * Core validation: turnstile sends QR → service validates → returns grant/deny.
 * This is the hot path — called for every person entering the venue.
 */
export async function validateForTurnstile(
  deviceId: string,
  qrPayload: string,
  direction: 'entry' | 'exit',
  startedAt: number,
  db: DbAdapter,
): Promise<TurnstileValidationResult> {
  const latencyMs = Date.now() - startedAt;

  // Get device config
  const devices = await db.query<DeviceRow>(
    `SELECT * FROM turnstiles.turnstile_devices WHERE device_id = $1 AND status = 'online'`,
    [deviceId],
  );

  if (!devices[0]) {
    const passage = await logPassage(deviceId, qrPayload, direction, null, 'denied', 'DEVICE_OFFLINE', DEFAULT_GATE_OPEN_MS, latencyMs, db);
    return { result: 'denied', gateOpenMs: 0, denyReason: 'DEVICE_OFFLINE', ticketId: null, holderName: null, passageId: passage.id };
  }

  // Validate ticket from QR — query ticket status
  const tickets = await db.query<{
    id: string;
    holder_name: string;
    status: string;
    event_id: string;
  }>(
    `SELECT t.id, t.holder_name, t.status, tt.event_id
     FROM tickets.tickets t
     JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.qr_payload = $1`,
    [qrPayload],
  );

  if (!tickets[0]) {
    const passage = await logPassage(deviceId, qrPayload, direction, null, 'denied', 'TICKET_NOT_FOUND', 0, latencyMs, db);
    return { result: 'denied', gateOpenMs: 0, denyReason: 'TICKET_NOT_FOUND', ticketId: null, holderName: null, passageId: passage.id };
  }

  const ticket = tickets[0];

  if (ticket.status === 'cancelled' || ticket.status === 'refunded') {
    const passage = await logPassage(deviceId, qrPayload, direction, ticket.id, 'denied', 'TICKET_INVALID', 0, latencyMs, db);
    return { result: 'denied', gateOpenMs: 0, denyReason: 'TICKET_INVALID', ticketId: ticket.id, holderName: ticket.holder_name, passageId: passage.id };
  }

  // Grant access
  const passage = await logPassage(deviceId, qrPayload, direction, ticket.id, 'granted', null, DEFAULT_GATE_OPEN_MS, latencyMs, db);

  // Update capacity counter
  await db.execute(
    `INSERT INTO turnstiles.capacity_counters (device_id, event_id, entries_count, exits_count, current_inside, last_passage_at)
     VALUES ($1, $2,
       CASE WHEN $3 = 'entry' THEN 1 ELSE 0 END,
       CASE WHEN $3 = 'exit' THEN 1 ELSE 0 END,
       CASE WHEN $3 = 'entry' THEN 1 ELSE -1 END,
       NOW())
     ON CONFLICT (device_id, event_id) DO UPDATE SET
       entries_count = turnstiles.capacity_counters.entries_count + CASE WHEN $3 = 'entry' THEN 1 ELSE 0 END,
       exits_count = turnstiles.capacity_counters.exits_count + CASE WHEN $3 = 'exit' THEN 1 ELSE 0 END,
       current_inside = GREATEST(0, turnstiles.capacity_counters.current_inside + CASE WHEN $3 = 'entry' THEN 1 ELSE -1 END),
       last_passage_at = NOW()`,
    [deviceId, ticket.event_id, direction],
  );

  return {
    result: 'granted',
    gateOpenMs: DEFAULT_GATE_OPEN_MS,
    denyReason: null,
    ticketId: ticket.id,
    holderName: ticket.holder_name,
    passageId: passage.id,
  };
}

/**
 * Device heartbeat: update online status.
 */
export async function heartbeat(
  deviceId: string,
  firmwareVersion: string | null,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE turnstiles.turnstile_devices
     SET status = 'online', last_heartbeat_at = NOW(),
         firmware_version = COALESCE($2, firmware_version)
     WHERE device_id = $1`,
    [deviceId, firmwareVersion],
  );
}

/**
 * Get capacity status for all turnstiles at an event.
 */
export async function getCapacityStatus(
  eventId: string,
  db: DbAdapter,
): Promise<CapacityStatus[]> {
  const rows = await db.query<CounterRow>(
    `SELECT * FROM turnstiles.capacity_counters WHERE event_id = $1`,
    [eventId],
  );
  return rows.map((r) => ({
    deviceId: r.device_id,
    eventId: r.event_id,
    entriesCount: r.entries_count,
    exitsCount: r.exits_count,
    currentInside: r.current_inside,
    lastPassageAt: r.last_passage_at,
  }));
}

/**
 * List all devices for an event.
 */
export async function listDevices(eventId: string, db: DbAdapter): Promise<TurnstileDevice[]> {
  const rows = await db.query<DeviceRow>(
    `SELECT * FROM turnstiles.turnstile_devices WHERE event_id = $1 ORDER BY name ASC`,
    [eventId],
  );
  return rows.map(mapDevice);
}

// Internal helper to log each passage
async function logPassage(
  deviceId: string,
  qrPayload: string,
  direction: 'entry' | 'exit',
  ticketId: string | null,
  result: 'granted' | 'denied' | 'error',
  denyReason: string | null,
  gateOpenMs: number,
  latencyMs: number,
  db: DbAdapter,
): Promise<TurnstilePassage> {
  const rows = await db.query<PassageRow>(
    `INSERT INTO turnstiles.turnstile_passages
       (device_id, ticket_id, qr_payload, direction, result, deny_reason, gate_open_ms, latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [deviceId, ticketId, qrPayload, direction, result, denyReason, gateOpenMs, latencyMs],
  );
  return mapPassage(rows[0]);
}
