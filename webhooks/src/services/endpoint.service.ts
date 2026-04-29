import { WebhookError } from '../lib/webhook-errors';
import { isValidEventType } from '../lib/webhook-events';
import { generateWebhookSecret } from '../lib/webhook-signature';

// ---------------------------------------------------------------------------
// DB interface
// ---------------------------------------------------------------------------

export interface WebhookDB {
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  execute: (sql: string, params?: unknown[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookEndpoint {
  id: string;
  promoterId: string;
  url: string;
  description: string | null;
  secret: string;
  events: string[];
  isActive: boolean;
  timeoutMs: number;
  maxRetries: number;
  createdAt: string;
  lastTriggeredAt: string | null;
}

export interface CreateEndpointInput {
  url: string;
  description?: string | null;
  secret?: string;
  events: string[];
  isActive?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface UpdateEndpointInput {
  url?: string;
  description?: string | null;
  events?: string[];
  isActive?: boolean;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface EndpointRow {
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
// Mapper
// ---------------------------------------------------------------------------

function mapEndpoint(row: EndpointRow, maskSecret = true): WebhookEndpoint {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    url: row.url,
    description: row.description,
    secret: maskSecret ? '***' : row.secret,
    events: row.events,
    isActive: row.is_active,
    timeoutMs: row.timeout_ms,
    maxRetries: row.max_retries,
    createdAt: row.created_at,
    lastTriggeredAt: row.last_triggered_at,
  };
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function createEndpoint(
  promoterId: string,
  input: CreateEndpointInput,
  db: WebhookDB,
): Promise<WebhookEndpoint> {
  // Validate all event types
  const invalidTypes = input.events.filter((e) => !isValidEventType(e));
  if (invalidTypes.length > 0) {
    throw new WebhookError('INVALID_EVENT_TYPE', `Invalid event types: ${invalidTypes.join(', ')}`);
  }

  // Auto-generate secret if not provided
  const secret = input.secret ?? generateWebhookSecret();

  try {
    await db.execute(
      `INSERT INTO reservations.webhook_endpoints
         (promoter_id, url, description, secret, events, is_active, timeout_ms, max_retries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        promoterId,
        input.url,
        input.description ?? null,
        secret,
        input.events,
        input.isActive ?? true,
        input.timeoutMs ?? 5000,
        input.maxRetries ?? 3,
      ],
    );
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message &&
      (err.message.includes('unique') || err.message.includes('duplicate') || err.message.includes('23505'))
    ) {
      throw new WebhookError('ENDPOINT_DUPLICATE');
    }
    throw err;
  }

  const { rows } = await db.query<EndpointRow>(
    `SELECT * FROM reservations.webhook_endpoints
     WHERE promoter_id = $1 AND url = $2`,
    [promoterId, input.url],
  );

  if (!rows[0]) {
    throw new WebhookError('ENDPOINT_DUPLICATE');
  }

  return mapEndpoint(rows[0], false);
}

export async function getEndpoint(endpointId: string, db: WebhookDB): Promise<WebhookEndpoint> {
  const { rows } = await db.query<EndpointRow>(
    `SELECT * FROM reservations.webhook_endpoints WHERE id = $1`,
    [endpointId],
  );

  if (!rows[0]) {
    throw new WebhookError('ENDPOINT_NOT_FOUND');
  }

  return mapEndpoint(rows[0], true);
}

export async function getEndpointWithSecret(endpointId: string, db: WebhookDB): Promise<WebhookEndpoint> {
  const { rows } = await db.query<EndpointRow>(
    `SELECT * FROM reservations.webhook_endpoints WHERE id = $1`,
    [endpointId],
  );

  if (!rows[0]) {
    throw new WebhookError('ENDPOINT_NOT_FOUND');
  }

  return mapEndpoint(rows[0], false);
}

export async function listEndpoints(promoterId: string, db: WebhookDB): Promise<WebhookEndpoint[]> {
  const { rows } = await db.query<EndpointRow>(
    `SELECT * FROM reservations.webhook_endpoints
     WHERE promoter_id = $1
     ORDER BY created_at ASC`,
    [promoterId],
  );

  return rows.map((row) => mapEndpoint(row, true));
}

export async function updateEndpoint(
  endpointId: string,
  input: UpdateEndpointInput,
  db: WebhookDB,
): Promise<WebhookEndpoint> {
  // Validate event types if provided
  if (input.events) {
    const invalidTypes = input.events.filter((e) => !isValidEventType(e));
    if (invalidTypes.length > 0) {
      throw new WebhookError('INVALID_EVENT_TYPE', `Invalid event types: ${invalidTypes.join(', ')}`);
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.url !== undefined) { sets.push(`url = $${idx++}`); params.push(input.url); }
  if (input.description !== undefined) { sets.push(`description = $${idx++}`); params.push(input.description); }
  if (input.events !== undefined) { sets.push(`events = $${idx++}`); params.push(input.events); }
  if (input.isActive !== undefined) { sets.push(`is_active = $${idx++}`); params.push(input.isActive); }
  if (input.timeoutMs !== undefined) { sets.push(`timeout_ms = $${idx++}`); params.push(input.timeoutMs); }

  if (sets.length > 0) {
    params.push(endpointId);
    await db.execute(
      `UPDATE reservations.webhook_endpoints SET ${sets.join(', ')} WHERE id = $${idx}`,
      params,
    );
  }

  return getEndpoint(endpointId, db);
}

export async function deleteEndpoint(endpointId: string, db: WebhookDB): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.webhook_endpoints WHERE id = $1`,
    [endpointId],
  );
}

export async function rotateSecret(endpointId: string, db: WebhookDB): Promise<string> {
  const newSecret = generateWebhookSecret();

  await db.execute(
    `UPDATE reservations.webhook_endpoints SET secret = $1 WHERE id = $2`,
    [newSecret, endpointId],
  );

  return newSecret;
}
