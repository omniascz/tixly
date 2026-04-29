import { WebhookError } from '../lib/webhook-errors';
import { retryDelayMs } from '@shared/webhooks';
import type { WebhookDB } from './endpoint.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeliveryStatus = 'pending' | 'success' | 'failed' | 'retrying';

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventType: string;
  eventId: string;
  payload: unknown;
  status: DeliveryStatus;
  attemptCount: number;
  nextRetryAt: string | null;
  lastResponseStatus: number | null;
  lastResponseBody: string | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface DeliveryFilters {
  status?: DeliveryStatus;
  eventType?: string;
}

export interface DeliveryStats {
  total: number;
  success: number;
  failed: number;
  pending: number;
  successRate: number;
}

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface DeliveryRow {
  id: string;
  endpoint_id: string;
  event_type: string;
  event_id: string;
  payload: unknown;
  status: DeliveryStatus;
  attempt_count: number;
  next_retry_at: string | null;
  last_response_status: number | null;
  last_response_body: string | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
}

interface StatsRow {
  total: string | number;
  success: string | number;
  failed: string | number;
  pending: string | number;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    endpointId: row.endpoint_id,
    eventType: row.event_type,
    eventId: row.event_id,
    payload: row.payload,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    nextRetryAt: row.next_retry_at,
    lastResponseStatus: row.last_response_status,
    lastResponseBody: row.last_response_body,
    lastError: row.last_error,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function scheduleDelivery(
  endpointId: string,
  eventType: string,
  eventId: string,
  payload: unknown,
  db: WebhookDB,
): Promise<WebhookDelivery> {
  await db.execute(
    `INSERT INTO reservations.webhook_deliveries
       (endpoint_id, event_type, event_id, payload, status, attempt_count)
     VALUES ($1, $2, $3, $4, 'pending', 0)`,
    [endpointId, eventType, eventId, JSON.stringify(payload)],
  );

  const { rows } = await db.query<DeliveryRow>(
    `SELECT * FROM reservations.webhook_deliveries
     WHERE endpoint_id = $1 AND event_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [endpointId, eventId],
  );

  if (!rows[0]) {
    throw new WebhookError('DELIVERY_NOT_FOUND');
  }

  return mapDelivery(rows[0]);
}

export async function getDelivery(deliveryId: string, db: WebhookDB): Promise<WebhookDelivery> {
  const { rows } = await db.query<DeliveryRow>(
    `SELECT * FROM reservations.webhook_deliveries WHERE id = $1`,
    [deliveryId],
  );

  if (!rows[0]) {
    throw new WebhookError('DELIVERY_NOT_FOUND');
  }

  return mapDelivery(rows[0]);
}

export async function listDeliveries(
  endpointId: string,
  filters: DeliveryFilters,
  db: WebhookDB,
): Promise<WebhookDelivery[]> {
  const conditions: string[] = ['endpoint_id = $1'];
  const params: unknown[] = [endpointId];
  let idx = 2;

  if (filters.status !== undefined) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }

  if (filters.eventType !== undefined) {
    conditions.push(`event_type = $${idx++}`);
    params.push(filters.eventType);
  }

  const { rows } = await db.query<DeliveryRow>(
    `SELECT * FROM reservations.webhook_deliveries
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 50`,
    params,
  );

  return rows.map(mapDelivery);
}

export async function markSuccess(
  deliveryId: string,
  responseStatus: number,
  responseBody: string,
  db: WebhookDB,
): Promise<void> {
  await db.execute(
    `UPDATE reservations.webhook_deliveries
     SET status = 'success',
         delivered_at = NOW(),
         last_response_status = $1,
         last_response_body = $2,
         attempt_count = attempt_count + 1
     WHERE id = $3`,
    [responseStatus, responseBody, deliveryId],
  );
}

export async function markFailed(
  deliveryId: string,
  error: string,
  responseStatus: number | null,
  db: WebhookDB,
): Promise<void> {
  await db.execute(
    `UPDATE reservations.webhook_deliveries
     SET status = 'failed',
         last_error = $1,
         last_response_status = $2,
         attempt_count = attempt_count + 1
     WHERE id = $3`,
    [error, responseStatus, deliveryId],
  );
}

export async function scheduleRetry(deliveryId: string, db: WebhookDB): Promise<void> {
  // Use shared exponential backoff from @shared/webhooks
  const { rows } = await db.query<{ attempt_count: number | string }>(
    `SELECT attempt_count FROM reservations.webhook_deliveries WHERE id = $1`,
    [deliveryId],
  );

  const attemptCount = rows[0] ? Number(rows[0].attempt_count) : 1;
  const delayMs = retryDelayMs(attemptCount, {
    maxRetries: 10,
    initialDelaySec: 60,       // 1 min base (was 2^1 = 2 min)
    maxDelaySec: 3600,         // 60 min cap (was also 60 min)
    backoffMultiplier: 2,
    autoDisableThreshold: 0,
  });
  const nextRetryAt = new Date(Date.now() + delayMs).toISOString();

  await db.execute(
    `UPDATE reservations.webhook_deliveries
     SET status = 'retrying',
         next_retry_at = $1
     WHERE id = $2`,
    [nextRetryAt, deliveryId],
  );
}

export async function getPendingDeliveries(db: WebhookDB): Promise<WebhookDelivery[]> {
  const { rows } = await db.query<DeliveryRow>(
    `SELECT * FROM reservations.webhook_deliveries
     WHERE status IN ('pending', 'retrying')
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
     ORDER BY created_at ASC
     LIMIT 100`,
    [],
  );

  return rows.map(mapDelivery);
}

export async function getDeliveryStats(endpointId: string, db: WebhookDB): Promise<DeliveryStats> {
  const { rows } = await db.query<StatsRow>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'success') AS success,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed,
       COUNT(*) FILTER (WHERE status IN ('pending', 'retrying')) AS pending
     FROM reservations.webhook_deliveries
     WHERE endpoint_id = $1`,
    [endpointId],
  );

  const row = rows[0];
  const total = row ? Number(row.total) : 0;
  const success = row ? Number(row.success) : 0;
  const failed = row ? Number(row.failed) : 0;
  const pending = row ? Number(row.pending) : 0;
  const successRate = total > 0 ? success / total : 0;

  return { total, success, failed, pending, successRate };
}
