/**
 * Tests for B2B API webhook delivery service.
 * Covers: signing, replay attack prevention, retry logic, auto-disable.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  signWebhook,
  verifyWebhookSignature,
  WebhookDeliveryService,
} from '../services/webhook-delivery.service.js';
import type { WebhookDBAdapter, HttpAdapter } from '../services/webhook-delivery.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): WebhookDBAdapter {
  return {
    getEndpointsForEvent: vi.fn().mockResolvedValue([]),
    createDelivery: vi.fn().mockResolvedValue('delivery-001'),
    getPendingDeliveries: vi.fn().mockResolvedValue([]),
    markDelivered: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    incrementEndpointFailure: vi.fn().mockResolvedValue(1),
    resetEndpointFailure: vi.fn().mockResolvedValue(undefined),
    disableEndpoint: vi.fn().mockResolvedValue(undefined),
  };
}

function makeHttp(status = 200, ok = true): HttpAdapter {
  return { post: vi.fn().mockResolvedValue({ status, ok }) };
}

const endpoint = {
  id: 'ep-001',
  url: 'https://example.com/hooks',
  events: ['order.paid'],
  signingSecret: 'my-secret',
  status: 'active',
  failureCount: 0,
};

// ---------------------------------------------------------------------------
// signWebhook
// ---------------------------------------------------------------------------

describe('signWebhook', () => {
  it('returns t=<ts>,v1=<hex64> format', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = signWebhook('{"type":"order.paid"}', 'mysecret', ts);
    expect(sig).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
  });

  it('same inputs always produce same signature (deterministic)', () => {
    const ts = 1712345678;
    const payload = '{"id":"abc"}';
    const secret = 'stable-secret';
    expect(signWebhook(payload, secret, ts)).toBe(signWebhook(payload, secret, ts));
  });

  it('different secrets produce different signatures', () => {
    const ts = 1712345678;
    const payload = '{"hello":"world"}';
    expect(signWebhook(payload, 'secret1', ts)).not.toBe(signWebhook(payload, 'secret2', ts));
  });

  it('different timestamps produce different signatures', () => {
    const payload = '{"type":"test"}';
    const secret = 'mysecret';
    expect(signWebhook(payload, secret, 1000)).not.toBe(signWebhook(payload, secret, 2000));
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature
// ---------------------------------------------------------------------------

describe('verifyWebhookSignature', () => {
  it('validates a fresh valid signature', () => {
    const payload = '{"type":"ticket.issued"}';
    const secret = 'verysecret';
    const ts = Math.floor(Date.now() / 1000);
    const header = signWebhook(payload, secret, ts);
    expect(verifyWebhookSignature(payload, header, secret)).toBe(true);
  });

  it('rejects tampered payload', () => {
    const secret = 'verysecret';
    const ts = Math.floor(Date.now() / 1000);
    const header = signWebhook('original', secret, ts);
    expect(verifyWebhookSignature('tampered', header, secret)).toBe(false);
  });

  it('rejects wrong secret', () => {
    const payload = 'test payload';
    const ts = Math.floor(Date.now() / 1000);
    const header = signWebhook(payload, 'correct-secret', ts);
    expect(verifyWebhookSignature(payload, header, 'wrong-secret')).toBe(false);
  });

  it('rejects replay attack (timestamp older than tolerance)', () => {
    const payload = '{"type":"order.paid"}';
    const secret = 'mysecret';
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // > 300s default tolerance
    const header = signWebhook(payload, secret, oldTimestamp);
    expect(verifyWebhookSignature(payload, header, secret, 300)).toBe(false);
  });

  it('accepts timestamp within custom tolerance window', () => {
    const payload = '{"type":"order.paid"}';
    const secret = 'mysecret';
    const ts = Math.floor(Date.now() / 1000) - 50; // 50s ago
    const header = signWebhook(payload, secret, ts);
    expect(verifyWebhookSignature(payload, header, secret, 300)).toBe(true);
  });

  it('rejects malformed header (missing t= or v1=)', () => {
    expect(verifyWebhookSignature('payload', 'no-commas-no-equals', 'secret')).toBe(false);
    expect(verifyWebhookSignature('payload', 'v1=abc', 'secret')).toBe(false); // missing t
  });
});

// ---------------------------------------------------------------------------
// WebhookDeliveryService.enqueue
// ---------------------------------------------------------------------------

describe('WebhookDeliveryService.enqueue', () => {
  it('creates deliveries for all subscribed endpoints', async () => {
    const db = makeDb();
    (db.getEndpointsForEvent as any).mockResolvedValue([endpoint, { ...endpoint, id: 'ep-002' }]);
    const svc = new WebhookDeliveryService(db, makeHttp());

    await svc.enqueue('promo-001', 'order.paid', { orderId: 'o-001' });

    expect(db.createDelivery).toHaveBeenCalledTimes(2);
    const [call1] = (db.createDelivery as any).mock.calls;
    expect(call1[0].eventType).toBe('order.paid');
    expect(call1[0].payload.type).toBe('order.paid');
    expect(call1[0].payload.api_version).toBe('2026-04-06');
    expect(typeof call1[0].payload.id).toBe('string');
    expect(call1[0].payload.data.orderId).toBe('o-001');
  });

  it('does not create deliveries when no endpoints subscribed', async () => {
    const db = makeDb();
    (db.getEndpointsForEvent as any).mockResolvedValue([]);
    const svc = new WebhookDeliveryService(db, makeHttp());

    await svc.enqueue('promo-001', 'order.paid', {});

    expect(db.createDelivery).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WebhookDeliveryService.processBatch
// ---------------------------------------------------------------------------

describe('WebhookDeliveryService.processBatch', () => {
  const pendingDelivery = {
    id: 'del-001',
    endpointId: 'ep-001',
    eventType: 'order.paid' as const,
    payload: {
      id: 'del-001',
      type: 'order.paid' as const,
      created_at: new Date().toISOString(),
      data: { promoter_id: 'promo-001', orderId: 'o-001' },
      api_version: '2026-04-06' as const,
    },
    attemptCount: 0,
  };

  it('marks delivery as delivered on 2xx response', async () => {
    const db = makeDb();
    (db.getPendingDeliveries as any).mockResolvedValue([pendingDelivery]);
    (db.getEndpointsForEvent as any).mockResolvedValue([endpoint]);
    const http = makeHttp(200, true);
    const svc = new WebhookDeliveryService(db, http);

    await svc.processBatch(1);

    expect(http.post).toHaveBeenCalledOnce();
    expect(db.markDelivered).toHaveBeenCalledWith('del-001');
    expect(db.resetEndpointFailure).toHaveBeenCalledWith('ep-001');
  });

  it('marks delivery as failed on 5xx response and schedules retry', async () => {
    const db = makeDb();
    (db.getPendingDeliveries as any).mockResolvedValue([pendingDelivery]);
    (db.getEndpointsForEvent as any).mockResolvedValue([endpoint]);
    (db.incrementEndpointFailure as any).mockResolvedValue(1);
    const http = makeHttp(500, false);
    const svc = new WebhookDeliveryService(db, http);

    await svc.processBatch(1);

    expect(db.markFailed).toHaveBeenCalledWith(
      'del-001',
      500,
      'HTTP 500',
      expect.any(Date), // next retry scheduled
    );
  });

  it('marks delivery as abandoned after MAX_ATTEMPTS reached', async () => {
    const exhaustedDelivery = { ...pendingDelivery, attemptCount: 4 }; // 4 = MAX_ATTEMPTS - 1
    const db = makeDb();
    (db.getPendingDeliveries as any).mockResolvedValue([exhaustedDelivery]);
    (db.getEndpointsForEvent as any).mockResolvedValue([endpoint]);
    (db.incrementEndpointFailure as any).mockResolvedValue(1);
    const http = makeHttp(503, false);
    const svc = new WebhookDeliveryService(db, http);

    await svc.processBatch(1);

    expect(db.markFailed).toHaveBeenCalledWith(
      'del-001',
      503,
      'HTTP 503',
      null, // null = abandoned, no more retries
    );
  });

  it('handles network errors (throws) gracefully', async () => {
    const db = makeDb();
    (db.getPendingDeliveries as any).mockResolvedValue([pendingDelivery]);
    (db.getEndpointsForEvent as any).mockResolvedValue([endpoint]);
    (db.incrementEndpointFailure as any).mockResolvedValue(1);
    const http: HttpAdapter = {
      post: vi.fn().mockRejectedValue(new Error('Connection timeout')),
    };
    const svc = new WebhookDeliveryService(db, http);

    // Should not throw — errors are caught internally
    await expect(svc.processBatch(1)).resolves.not.toThrow();

    expect(db.markFailed).toHaveBeenCalledWith(
      'del-001',
      null, // no HTTP status on network error
      expect.stringContaining('timeout'),
      expect.anything(),
    );
  });

  it('auto-disables endpoint when failure count reaches AUTO_DISABLE_THRESHOLD (50)', async () => {
    const db = makeDb();
    (db.getPendingDeliveries as any).mockResolvedValue([pendingDelivery]);
    (db.getEndpointsForEvent as any).mockResolvedValue([endpoint]);
    (db.incrementEndpointFailure as any).mockResolvedValue(50); // threshold reached
    const http = makeHttp(503, false);
    const svc = new WebhookDeliveryService(db, http);

    await svc.processBatch(1);

    expect(db.disableEndpoint).toHaveBeenCalledWith('ep-001', 'auto_disabled');
  });

  it('does not disable endpoint below threshold (49 failures)', async () => {
    const db = makeDb();
    (db.getPendingDeliveries as any).mockResolvedValue([pendingDelivery]);
    (db.getEndpointsForEvent as any).mockResolvedValue([endpoint]);
    (db.incrementEndpointFailure as any).mockResolvedValue(49); // one below threshold
    const http = makeHttp(503, false);
    const svc = new WebhookDeliveryService(db, http);

    await svc.processBatch(1);

    expect(db.disableEndpoint).not.toHaveBeenCalled();
  });

  it('includes correct webhook headers on POST', async () => {
    const db = makeDb();
    (db.getPendingDeliveries as any).mockResolvedValue([pendingDelivery]);
    (db.getEndpointsForEvent as any).mockResolvedValue([endpoint]);
    let capturedHeaders: Record<string, string> = {};
    const http: HttpAdapter = {
      post: vi.fn().mockImplementation(async (_url, _body, headers) => {
        capturedHeaders = headers;
        return { status: 200, ok: true };
      }),
    };
    const svc = new WebhookDeliveryService(db, http);

    await svc.processBatch(1);

    expect(capturedHeaders['Content-Type']).toBe('application/json');
    expect(capturedHeaders['Tixly-Signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(capturedHeaders['Tixly-Event']).toBe('order.paid');
    expect(capturedHeaders['Tixly-Delivery-Id']).toBe('del-001');
  });

  it('skips disabled endpoints', async () => {
    const disabledEndpoint = { ...endpoint, status: 'disabled' };
    const db = makeDb();
    (db.getPendingDeliveries as any).mockResolvedValue([pendingDelivery]);
    (db.getEndpointsForEvent as any).mockResolvedValue([disabledEndpoint]);
    const http = makeHttp();
    const svc = new WebhookDeliveryService(db, http);

    await svc.processBatch(1);

    expect(http.post).not.toHaveBeenCalled();
    expect(db.markFailed).toHaveBeenCalledWith('del-001', null, 'endpoint_disabled', null);
  });
});
