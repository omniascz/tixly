import { randomUUID } from 'crypto';
import { buildPayload, generateSignature } from '../lib/webhook-signature';
import { logEvent } from './event-log.service';
import { scheduleDelivery, markSuccess, markFailed, scheduleRetry, getPendingDeliveries } from './delivery.service';
import type { WebhookDB } from './endpoint.service';
import type { WebhookDelivery } from './delivery.service';
import type { WebhookEndpoint } from './endpoint.service';

// ---------------------------------------------------------------------------
// HttpClient interface (injectable for testing)
// ---------------------------------------------------------------------------

export interface HttpClient {
  post(
    url: string,
    payload: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<{ status: number; body: string }>;
}

// ---------------------------------------------------------------------------
// Default HTTP client (uses fetch)
// ---------------------------------------------------------------------------

const defaultHttpClient: HttpClient = {
  async post(url, payload, headers, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      });

      const body = await response.text();
      return { status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  },
};

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface ActiveEndpointRow {
  id: string;
  promoter_id: string;
  url: string;
  description: string | null;
  secret: string;
  events: string[];
  is_active: boolean;
  timeout_ms: number;
  max_retries: number;
  created_at: string;
  last_triggered_at: string | null;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function dispatchEvent(
  promoterId: string,
  eventType: string,
  sourceEntityType: string | null,
  sourceEntityId: string | null,
  data: unknown,
  db: WebhookDB,
  httpClient?: HttpClient,
): Promise<{ eventId: string; deliveriesScheduled: number }> {
  const eventId = randomUUID();

  // 1. Insert into event log
  await logEvent(promoterId, eventType, sourceEntityType, sourceEntityId, data, db);

  // 2. Find active endpoints for this promoter that subscribe to this event type
  const { rows: endpointRows } = await db.query<ActiveEndpointRow>(
    `SELECT * FROM reservations.webhook_endpoints
     WHERE promoter_id = $1
       AND is_active = true
       AND $2 = ANY(events)`,
    [promoterId, eventType],
  );

  if (endpointRows.length === 0) {
    return { eventId, deliveriesScheduled: 0 };
  }

  // 3. Build payload
  const payload = buildPayload(eventType, eventId, data);
  const payloadStr = JSON.stringify(payload);

  // 4. Schedule and optionally send deliveries for each endpoint
  const client = httpClient ?? defaultHttpClient;
  let deliveriesScheduled = 0;

  for (const endpointRow of endpointRows) {
    const delivery = await scheduleDelivery(endpointRow.id, eventType, eventId, payload, db);
    deliveriesScheduled++;

    // 5. Attempt delivery immediately if httpClient provided (or use default)
    const endpoint: WebhookEndpoint = {
      id: endpointRow.id,
      promoterId: endpointRow.promoter_id,
      url: endpointRow.url,
      description: endpointRow.description,
      secret: endpointRow.secret,
      events: endpointRow.events,
      isActive: endpointRow.is_active,
      timeoutMs: endpointRow.timeout_ms,
      maxRetries: endpointRow.max_retries,
      createdAt: endpointRow.created_at,
      lastTriggeredAt: endpointRow.last_triggered_at,
    };

    await sendDelivery(delivery, endpoint, payloadStr, db, client);
  }

  return { eventId, deliveriesScheduled };
}

export async function sendDelivery(
  delivery: WebhookDelivery,
  endpoint: WebhookEndpoint,
  payloadStrOrNull: string | null,
  db: WebhookDB,
  httpClient: HttpClient,
): Promise<void> {
  const payloadStr = payloadStrOrNull ?? JSON.stringify(delivery.payload);
  const signature = generateSignature(payloadStr, endpoint.secret);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Tixly-Signature': signature,
    'X-Tixly-Event': delivery.eventType,
    'X-Tixly-Delivery-Id': delivery.id,
  };

  try {
    const response = await httpClient.post(endpoint.url, payloadStr, headers, endpoint.timeoutMs);

    if (response.status >= 200 && response.status < 300) {
      await markSuccess(delivery.id, response.status, response.body, db);
    } else {
      await markFailed(delivery.id, `HTTP ${response.status}`, response.status, db);

      if (delivery.attemptCount < endpoint.maxRetries) {
        await scheduleRetry(delivery.id, db);
      }
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await markFailed(delivery.id, errorMessage, null, db);

    if (delivery.attemptCount < endpoint.maxRetries) {
      await scheduleRetry(delivery.id, db);
    }
  }
}

export async function processRetryQueue(db: WebhookDB, httpClient?: HttpClient): Promise<number> {
  const deliveries = await getPendingDeliveries(db);
  const client = httpClient ?? defaultHttpClient;
  let processed = 0;

  for (const delivery of deliveries) {
    // Fetch endpoint details for this delivery
    const { rows: endpointRows } = await db.query<ActiveEndpointRow>(
      `SELECT * FROM reservations.webhook_endpoints WHERE id = $1`,
      [delivery.endpointId],
    );

    if (!endpointRows[0]) {
      continue;
    }

    const endpointRow = endpointRows[0];
    const endpoint: WebhookEndpoint = {
      id: endpointRow.id,
      promoterId: endpointRow.promoter_id,
      url: endpointRow.url,
      description: endpointRow.description,
      secret: endpointRow.secret,
      events: endpointRow.events,
      isActive: endpointRow.is_active,
      timeoutMs: endpointRow.timeout_ms,
      maxRetries: endpointRow.max_retries,
      createdAt: endpointRow.created_at,
      lastTriggeredAt: endpointRow.last_triggered_at,
    };

    await sendDelivery(delivery, endpoint, null, db, client);
    processed++;
  }

  return processed;
}
