import type { WebhookDB } from './endpoint.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookEventLogEntry {
  id: string;
  promoterId: string;
  eventType: string;
  eventId: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  payload: unknown;
  createdAt: string;
}

export interface EventLogFilters {
  eventType?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface EventLogRow {
  id: string;
  promoter_id: string;
  event_type: string;
  event_id: string;
  source_entity_type: string | null;
  source_entity_id: string | null;
  payload: unknown;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapEventLog(row: EventLogRow): WebhookEventLogEntry {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    eventType: row.event_type,
    eventId: row.event_id,
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function logEvent(
  promoterId: string,
  eventType: string,
  sourceEntityType: string | null,
  sourceEntityId: string | null,
  payload: unknown,
  db: WebhookDB,
): Promise<void> {
  await db.execute(
    `INSERT INTO reservations.webhook_event_log
       (promoter_id, event_type, source_entity_type, source_entity_id, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [promoterId, eventType, sourceEntityType, sourceEntityId, JSON.stringify(payload)],
  );
}

export async function getEventLog(
  promoterId: string,
  filters: EventLogFilters,
  db: WebhookDB,
): Promise<WebhookEventLogEntry[]> {
  const conditions: string[] = ['promoter_id = $1'];
  const params: unknown[] = [promoterId];
  let idx = 2;

  if (filters.eventType !== undefined) {
    conditions.push(`event_type = $${idx++}`);
    params.push(filters.eventType);
  }

  if (filters.dateFrom !== undefined) {
    conditions.push(`created_at >= $${idx++}`);
    params.push(filters.dateFrom);
  }

  if (filters.dateTo !== undefined) {
    conditions.push(`created_at <= $${idx++}`);
    params.push(filters.dateTo);
  }

  const { rows } = await db.query<EventLogRow>(
    `SELECT * FROM reservations.webhook_event_log
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 100`,
    params,
  );

  return rows.map(mapEventLog);
}

export async function getEventById(eventId: string, db: WebhookDB): Promise<WebhookEventLogEntry | null> {
  const { rows } = await db.query<EventLogRow>(
    `SELECT * FROM reservations.webhook_event_log WHERE event_id = $1`,
    [eventId],
  );

  if (!rows[0]) {
    return null;
  }

  return mapEventLog(rows[0]);
}
