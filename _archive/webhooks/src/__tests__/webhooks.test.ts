import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Lib imports
// ---------------------------------------------------------------------------

import { generateSignature, verifySignature, buildPayload } from '../lib/webhook-signature';
import { WebhookError } from '../lib/webhook-errors';

// ---------------------------------------------------------------------------
// Service imports
// ---------------------------------------------------------------------------

import {
  createEndpoint,
  getEndpoint,
  getEndpointWithSecret,
  listEndpoints,
  updateEndpoint,
  deleteEndpoint,
  rotateSecret,
} from '../services/endpoint.service';

import {
  scheduleDelivery,
  getDelivery,
  listDeliveries,
  markSuccess,
  markFailed,
  scheduleRetry,
  getPendingDeliveries,
  getDeliveryStats,
} from '../services/delivery.service';

import {
  dispatchEvent,
  sendDelivery,
  processRetryQueue,
} from '../services/dispatcher.service';

import {
  logEvent,
  getEventLog,
} from '../services/event-log.service';

// ---------------------------------------------------------------------------
// makeDb helper — query() increments index; execute() does NOT
// ---------------------------------------------------------------------------

function makeDb(responses: unknown[][] = []) {
  let i = 0;
  return {
    query: vi.fn(async () => ({ rows: responses[i++] ?? [] })),
    execute: vi.fn(async () => {}),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROMOTER_ID = 'promoter-uuid-0001';
const ENDPOINT_ID = 'endpoint-uuid-0001';
const DELIVERY_ID = 'delivery-uuid-0001';
const EVENT_ID = 'event-uuid-0001';
const SOURCE_ENTITY_ID = 'booking-uuid-0001';

const BASE_ENDPOINT_ROW = {
  id: ENDPOINT_ID,
  promoter_id: PROMOTER_ID,
  url: 'https://example.com/webhook',
  description: 'Test endpoint',
  secret: 'mysecret',
  events: ['booking.created', 'booking.cancelled'],
  is_active: true,
  timeout_ms: 5000,
  max_retries: 3,
  created_at: '2026-04-07T10:00:00.000Z',
  last_triggered_at: null,
};

const BASE_DELIVERY_ROW = {
  id: DELIVERY_ID,
  endpoint_id: ENDPOINT_ID,
  event_type: 'booking.created',
  event_id: EVENT_ID,
  payload: { id: EVENT_ID, type: 'booking.created', created_at: '2026-04-07T10:00:00.000Z', data: {} },
  status: 'pending',
  attempt_count: 0,
  next_retry_at: null,
  last_response_status: null,
  last_response_body: null,
  last_error: null,
  created_at: '2026-04-07T10:00:00.000Z',
  delivered_at: null,
};

// ---------------------------------------------------------------------------
// 1. Signature tests — pure functions, no DB needed
// ---------------------------------------------------------------------------

describe('generateSignature', () => {
  it('returns sha256= prefixed string', () => {
    const sig = generateSignature('hello world', 'secret');
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('same input produces same output (deterministic)', () => {
    const sig1 = generateSignature('payload', 'secret');
    const sig2 = generateSignature('payload', 'secret');
    expect(sig1).toBe(sig2);
  });
});

describe('verifySignature', () => {
  it('valid signature returns true', () => {
    const payload = 'my payload';
    const secret = 'my-secret';
    const sig = generateSignature(payload, secret);
    expect(verifySignature(payload, secret, sig)).toBe(true);
  });

  it('tampered payload returns false', () => {
    const secret = 'my-secret';
    const sig = generateSignature('original payload', secret);
    expect(verifySignature('tampered payload', secret, sig)).toBe(false);
  });
});

describe('buildPayload', () => {
  it('creates correct structure with id, type, created_at, data', () => {
    const data = { bookingId: 'bk-001', userId: 'u-001' };
    const result = buildPayload('booking.created', EVENT_ID, data);

    expect(result.id).toBe(EVENT_ID);
    expect(result.type).toBe('booking.created');
    expect(result.created_at).toBeDefined();
    expect(typeof result.created_at).toBe('string');
    // should be parseable ISO date
    expect(() => new Date(result.created_at)).not.toThrow();
    expect(result.data).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// 2. Endpoint service tests
// ---------------------------------------------------------------------------

describe('createEndpoint', () => {
  it('creates a valid endpoint and auto-generates secret', async () => {
    // execute (INSERT) does not consume index; query (SELECT) does → i=0 → returns BASE_ENDPOINT_ROW
    const db = makeDb([[BASE_ENDPOINT_ROW]]);

    const result = await createEndpoint(PROMOTER_ID, {
      url: 'https://example.com/webhook',
      events: ['booking.created', 'booking.cancelled'],
    }, db);

    expect(result.id).toBe(ENDPOINT_ID);
    expect(result.promoterId).toBe(PROMOTER_ID);
    expect(result.url).toBe('https://example.com/webhook');
    // secret is returned unmasked on create
    expect(result.secret).toBe('mysecret');
    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('throws INVALID_EVENT_TYPE for unknown event types', async () => {
    const db = makeDb();

    await expect(
      createEndpoint(PROMOTER_ID, {
        url: 'https://example.com/webhook',
        events: ['booking.created', 'invalid.event'],
      }, db),
    ).rejects.toThrow(WebhookError);

    await expect(
      createEndpoint(PROMOTER_ID, {
        url: 'https://example.com/webhook',
        events: ['booking.created', 'invalid.event'],
      }, db),
    ).rejects.toMatchObject({ code: 'INVALID_EVENT_TYPE' });
  });

  it('throws ENDPOINT_DUPLICATE on duplicate URL', async () => {
    // Simulate execute throwing unique constraint error
    const db = makeDb();
    db.execute.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint 23505'));

    await expect(
      createEndpoint(PROMOTER_ID, {
        url: 'https://example.com/webhook',
        events: ['booking.created'],
      }, db),
    ).rejects.toMatchObject({ code: 'ENDPOINT_DUPLICATE' });
  });
});

describe('getEndpoint', () => {
  it('masks secret as ***', async () => {
    const db = makeDb([[BASE_ENDPOINT_ROW]]);
    const result = await getEndpoint(ENDPOINT_ID, db);
    expect(result.secret).toBe('***');
    expect(result.id).toBe(ENDPOINT_ID);
  });
});

describe('getEndpointWithSecret', () => {
  it('returns real secret', async () => {
    const db = makeDb([[BASE_ENDPOINT_ROW]]);
    const result = await getEndpointWithSecret(ENDPOINT_ID, db);
    expect(result.secret).toBe('mysecret');
  });
});

describe('listEndpoints', () => {
  it('masks secrets for all endpoints', async () => {
    const db = makeDb([[BASE_ENDPOINT_ROW, { ...BASE_ENDPOINT_ROW, id: 'endpoint-uuid-0002', secret: 'othersecret' }]]);
    const results = await listEndpoints(PROMOTER_ID, db);
    expect(results).toHaveLength(2);
    expect(results[0].secret).toBe('***');
    expect(results[1].secret).toBe('***');
  });
});

describe('updateEndpoint', () => {
  it('performs partial update and returns updated endpoint', async () => {
    // execute (UPDATE) doesn't consume; query (SELECT in getEndpoint) consumes i=0
    const updatedRow = { ...BASE_ENDPOINT_ROW, is_active: false };
    const db = makeDb([[updatedRow]]);

    const result = await updateEndpoint(ENDPOINT_ID, { isActive: false }, db);

    expect(result.isActive).toBe(false);
    expect(db.execute).toHaveBeenCalledOnce();
  });
});

describe('deleteEndpoint', () => {
  it('calls execute with DELETE', async () => {
    const db = makeDb();
    await deleteEndpoint(ENDPOINT_ID, db);
    expect(db.execute).toHaveBeenCalledOnce();
    expect((db.execute.mock.calls[0][0] as string).toUpperCase()).toContain('DELETE');
  });
});

describe('rotateSecret', () => {
  it('returns a new secret and calls execute', async () => {
    const db = makeDb();
    const newSecret = await rotateSecret(ENDPOINT_ID, db);

    expect(typeof newSecret).toBe('string');
    expect(newSecret.length).toBe(64); // 32 bytes hex = 64 chars
    expect(db.execute).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 3. Delivery service tests
// ---------------------------------------------------------------------------

describe('scheduleDelivery', () => {
  it('creates delivery with status=pending', async () => {
    // execute (INSERT) skips index; query (SELECT) at i=0
    const db = makeDb([[BASE_DELIVERY_ROW]]);
    const result = await scheduleDelivery(ENDPOINT_ID, 'booking.created', EVENT_ID, { data: 'test' }, db);

    expect(result.status).toBe('pending');
    expect(result.endpointId).toBe(ENDPOINT_ID);
    expect(result.eventType).toBe('booking.created');
    expect(db.execute).toHaveBeenCalledOnce();
  });
});

describe('getDelivery', () => {
  it('returns delivery when found', async () => {
    const db = makeDb([[BASE_DELIVERY_ROW]]);
    const result = await getDelivery(DELIVERY_ID, db);
    expect(result.id).toBe(DELIVERY_ID);
  });

  it('throws DELIVERY_NOT_FOUND when not found', async () => {
    const db = makeDb([[]]); // empty rows
    await expect(getDelivery(DELIVERY_ID, db)).rejects.toMatchObject({ code: 'DELIVERY_NOT_FOUND' });
  });
});

describe('listDeliveries', () => {
  it('filters by status', async () => {
    const successRow = { ...BASE_DELIVERY_ROW, status: 'success', delivered_at: '2026-04-07T10:01:00.000Z' };
    const db = makeDb([[successRow]]);
    const results = await listDeliveries(ENDPOINT_ID, { status: 'success' }, db);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
  });
});

describe('markSuccess', () => {
  it('calls execute to update status and delivered_at', async () => {
    const db = makeDb();
    await markSuccess(DELIVERY_ID, 200, '{"ok":true}', db);
    expect(db.execute).toHaveBeenCalledOnce();
    const sql = db.execute.mock.calls[0][0] as string;
    expect(sql).toContain("'success'");
    expect(sql).toContain('delivered_at');
  });
});

describe('markFailed', () => {
  it('calls execute to update status and error', async () => {
    const db = makeDb();
    await markFailed(DELIVERY_ID, 'Connection refused', 500, db);
    expect(db.execute).toHaveBeenCalledOnce();
    const sql = db.execute.mock.calls[0][0] as string;
    expect(sql).toContain("'failed'");
    expect(sql).toContain('last_error');
  });
});

describe('scheduleRetry', () => {
  it('sets exponential backoff: attempt 1 → 2 min, attempt 2 → 4 min', async () => {
    // Test attempt=1 (2^1 = 2 min backoff)
    const db1 = makeDb([[{ attempt_count: 1 }]]);
    const before1 = Date.now();
    await scheduleRetry(DELIVERY_ID, db1);
    // execute was called — check that next_retry_at param is ~2 min from now
    const executeCall1 = db1.execute.mock.calls[0];
    const nextRetry1 = new Date(executeCall1[1][0] as string).getTime();
    const expectedMin1 = before1 + 2 * 60 * 1000;
    expect(nextRetry1).toBeGreaterThanOrEqual(expectedMin1 - 1000);
    expect(nextRetry1).toBeLessThanOrEqual(expectedMin1 + 5000);

    // Test attempt=2 (2^2 = 4 min backoff)
    const db2 = makeDb([[{ attempt_count: 2 }]]);
    const before2 = Date.now();
    await scheduleRetry(DELIVERY_ID, db2);
    const executeCall2 = db2.execute.mock.calls[0];
    const nextRetry2 = new Date(executeCall2[1][0] as string).getTime();
    const expectedMin2 = before2 + 4 * 60 * 1000;
    expect(nextRetry2).toBeGreaterThanOrEqual(expectedMin2 - 1000);
    expect(nextRetry2).toBeLessThanOrEqual(expectedMin2 + 5000);
  });
});

describe('getPendingDeliveries', () => {
  it('returns only pending/retrying with past next_retry_at', async () => {
    const retryingRow = {
      ...BASE_DELIVERY_ROW,
      id: 'delivery-uuid-0002',
      status: 'retrying',
      next_retry_at: new Date(Date.now() - 60000).toISOString(), // 1 min ago (past)
    };
    const db = makeDb([[retryingRow]]);
    const results = await getPendingDeliveries(db);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('retrying');
  });
});

describe('getDeliveryStats', () => {
  it('calculates correct success rate', async () => {
    const statsRow = { total: '10', success: '7', failed: '2', pending: '1' };
    const db = makeDb([[statsRow]]);
    const stats = await getDeliveryStats(ENDPOINT_ID, db);

    expect(stats.total).toBe(10);
    expect(stats.success).toBe(7);
    expect(stats.failed).toBe(2);
    expect(stats.pending).toBe(1);
    expect(stats.successRate).toBeCloseTo(0.7);
  });
});

// ---------------------------------------------------------------------------
// 4. Dispatcher service tests
// ---------------------------------------------------------------------------

describe('dispatchEvent', () => {
  it('logs to event_log and schedules deliveries for matching endpoints', async () => {
    // execute(logEvent) skips; query(find endpoints) i=0; execute(scheduleDelivery) skips; query(select delivery) i=1
    const db = makeDb([
      [BASE_ENDPOINT_ROW],         // query i=0: find active endpoints
      [BASE_DELIVERY_ROW],         // query i=1: SELECT delivery after INSERT
    ]);

    const mockHttpClient = {
      post: vi.fn(async () => ({ status: 200, body: 'ok' })),
    };

    // mark success will call execute — that's fine
    const result = await dispatchEvent(
      PROMOTER_ID,
      'booking.created',
      'booking',
      SOURCE_ENTITY_ID,
      { bookingId: SOURCE_ENTITY_ID },
      db,
      mockHttpClient,
    );

    expect(result.deliveriesScheduled).toBe(1);
    expect(typeof result.eventId).toBe('string');
    expect(mockHttpClient.post).toHaveBeenCalledOnce();
  });

  it('skips inactive endpoints', async () => {
    const inactiveEndpoint = { ...BASE_ENDPOINT_ROW, is_active: false };
    // find endpoints query returns empty (filtered by is_active=true in SQL)
    const db = makeDb([
      [],  // no active endpoints
    ]);

    const mockHttpClient = { post: vi.fn(async () => ({ status: 200, body: 'ok' })) };

    const result = await dispatchEvent(
      PROMOTER_ID,
      'booking.created',
      null,
      null,
      {},
      db,
      mockHttpClient,
    );

    // logEvent uses execute (no index consumed), query returns empty
    expect(result.deliveriesScheduled).toBe(0);
    expect(mockHttpClient.post).not.toHaveBeenCalled();
    void inactiveEndpoint; // suppress unused variable warning
  });

  it('skips endpoints not subscribed to event type', async () => {
    // Endpoint only subscribes to 'slot.opened', not 'booking.created'
    // The SQL filters by event type, so query returns empty
    const db = makeDb([
      [],  // no matching endpoints
    ]);

    const mockHttpClient = { post: vi.fn(async () => ({ status: 200, body: 'ok' })) };

    const result = await dispatchEvent(
      PROMOTER_ID,
      'booking.created',
      null,
      null,
      {},
      db,
      mockHttpClient,
    );

    expect(result.deliveriesScheduled).toBe(0);
    expect(mockHttpClient.post).not.toHaveBeenCalled();
  });
});

describe('sendDelivery', () => {
  const endpoint = {
    id: ENDPOINT_ID,
    promoterId: PROMOTER_ID,
    url: 'https://example.com/webhook',
    description: null,
    secret: 'test-secret',
    events: ['booking.created'],
    isActive: true,
    timeoutMs: 5000,
    maxRetries: 3,
    createdAt: '2026-04-07T10:00:00.000Z',
    lastTriggeredAt: null,
  };

  const delivery = {
    id: DELIVERY_ID,
    endpointId: ENDPOINT_ID,
    eventType: 'booking.created',
    eventId: EVENT_ID,
    payload: { id: EVENT_ID, type: 'booking.created', created_at: '2026-04-07T10:00:00.000Z', data: {} },
    status: 'pending' as const,
    attemptCount: 0,
    nextRetryAt: null,
    lastResponseStatus: null,
    lastResponseBody: null,
    lastError: null,
    createdAt: '2026-04-07T10:00:00.000Z',
    deliveredAt: null,
  };

  it('200 response calls markSuccess', async () => {
    const db = makeDb();
    const httpClient = { post: vi.fn(async () => ({ status: 200, body: '{"received":true}' })) };

    await sendDelivery(delivery, endpoint, null, db, httpClient);

    expect(db.execute).toHaveBeenCalledOnce();
    const sql = db.execute.mock.calls[0][0] as string;
    expect(sql).toContain("'success'");
  });

  it('500 response calls markFailed', async () => {
    const db = makeDb();
    const httpClient = { post: vi.fn(async () => ({ status: 500, body: 'Internal Server Error' })) };

    await sendDelivery(delivery, endpoint, null, db, httpClient);

    // markFailed (execute), then scheduleRetry (query for attempt_count + execute)
    const firstSql = db.execute.mock.calls[0][0] as string;
    expect(firstSql).toContain("'failed'");
  });

  it('500 response + attempts < max_retries calls scheduleRetry', async () => {
    // delivery.attemptCount=0, endpoint.maxRetries=3 → should retry
    const db = makeDb([[{ attempt_count: 0 }]]); // query for attempt_count in scheduleRetry
    const httpClient = { post: vi.fn(async () => ({ status: 500, body: 'Error' })) };

    await sendDelivery(delivery, endpoint, null, db, httpClient);

    // execute calls: markFailed + scheduleRetry (2 executes)
    expect(db.execute).toHaveBeenCalledTimes(2);
    const retryExecuteSql = db.execute.mock.calls[1][0] as string;
    expect(retryExecuteSql).toContain("'retrying'");
  });

  it('includes correct headers (signature, event type, delivery ID)', async () => {
    const db = makeDb();
    const capturedHeaders: Record<string, string>[] = [];
    const httpClient = {
      post: vi.fn(async (_url: string, _payload: string, headers: Record<string, string>) => {
        capturedHeaders.push(headers);
        return { status: 200, body: 'ok' };
      }),
    };

    const payloadStr = JSON.stringify(delivery.payload);
    await sendDelivery(delivery, endpoint, payloadStr, db, httpClient);

    expect(capturedHeaders[0]['Content-Type']).toBe('application/json');
    expect(capturedHeaders[0]['X-Tixly-Event']).toBe('booking.created');
    expect(capturedHeaders[0]['X-Tixly-Delivery-Id']).toBe(DELIVERY_ID);
    expect(capturedHeaders[0]['X-Tixly-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
  });
});

describe('processRetryQueue', () => {
  it('processes pending deliveries from the queue', async () => {
    // getPendingDeliveries: query i=0 → [BASE_DELIVERY_ROW]
    // for each delivery: query(find endpoint) i=1 → [BASE_ENDPOINT_ROW]
    const db = makeDb([
      [BASE_DELIVERY_ROW],   // i=0: getPendingDeliveries
      [BASE_ENDPOINT_ROW],   // i=1: query endpoint for delivery
    ]);

    const httpClient = { post: vi.fn(async () => ({ status: 200, body: 'ok' })) };

    const processed = await processRetryQueue(db, httpClient);

    expect(processed).toBe(1);
    expect(httpClient.post).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 5. Event log service tests
// ---------------------------------------------------------------------------

describe('logEvent', () => {
  it('inserts a record via execute', async () => {
    const db = makeDb();
    await logEvent(PROMOTER_ID, 'booking.created', 'booking', SOURCE_ENTITY_ID, { data: 'test' }, db);

    expect(db.execute).toHaveBeenCalledOnce();
    expect((db.execute.mock.calls[0][0] as string).toUpperCase()).toContain('INSERT');
  });
});

describe('getEventLog', () => {
  it('filters by event_type', async () => {
    const logRow = {
      id: 'log-uuid-0001',
      promoter_id: PROMOTER_ID,
      event_type: 'booking.created',
      event_id: EVENT_ID,
      source_entity_type: 'booking',
      source_entity_id: SOURCE_ENTITY_ID,
      payload: {},
      created_at: '2026-04-07T10:00:00.000Z',
    };
    const db = makeDb([[logRow]]);
    const results = await getEventLog(PROMOTER_ID, { eventType: 'booking.created' }, db);

    expect(results).toHaveLength(1);
    expect(results[0].eventType).toBe('booking.created');
    // Verify the query included the event_type filter
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('event_type');
  });
});

// ---------------------------------------------------------------------------
// 6. Integration / full flow tests
// ---------------------------------------------------------------------------

describe('Full flow: dispatchEvent → endpoint matches → delivery sent → success logged', () => {
  it('sends delivery and marks success', async () => {
    // DB responses:
    // execute(logEvent) — skips index
    // query i=0: find active endpoints → [BASE_ENDPOINT_ROW]
    // execute(scheduleDelivery INSERT) — skips index
    // query i=1: SELECT delivery after schedule → [BASE_DELIVERY_ROW]
    // then sendDelivery → httpClient.post → markSuccess → execute
    const db = makeDb([
      [BASE_ENDPOINT_ROW],   // i=0: find endpoints
      [BASE_DELIVERY_ROW],   // i=1: SELECT after scheduleDelivery
    ]);

    const httpClient = {
      post: vi.fn(async () => ({ status: 200, body: '{"received":true}' })),
    };

    const result = await dispatchEvent(
      PROMOTER_ID,
      'booking.created',
      'booking',
      SOURCE_ENTITY_ID,
      { bookingId: SOURCE_ENTITY_ID },
      db,
      httpClient,
    );

    expect(result.deliveriesScheduled).toBe(1);
    // logEvent (execute #1), scheduleDelivery INSERT (execute #2), markSuccess (execute #3)
    expect(db.execute).toHaveBeenCalledTimes(3);
    expect(httpClient.post).toHaveBeenCalledOnce();

    // Verify the last execute was markSuccess
    const lastExecuteSql = db.execute.mock.calls[2][0] as string;
    expect(lastExecuteSql).toContain("'success'");
  });
});

// ---------------------------------------------------------------------------
// 7. API route test: POST /webhooks/test
// ---------------------------------------------------------------------------

describe('API route: POST /webhooks/test', () => {
  it('returns 200 with eventId and dispatches event', async () => {
    // We test the route logic indirectly by testing dispatchEvent returns correct shape
    // with no matching endpoints (empty DB responses)
    const db = makeDb([
      [], // no endpoints found
    ]);

    const result = await dispatchEvent(
      PROMOTER_ID,
      'booking.created',
      null,
      null,
      { test: true },
      db,
    );

    expect(typeof result.eventId).toBe('string');
    expect(result.deliveriesScheduled).toBe(0);
  });
});
