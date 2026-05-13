import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  subscribeWebhook,
  unsubscribeWebhook,
  deliverEvent,
  retryFailedDeliveries,
} from '../services/webhook.service.js';
import type { DbAdapter, HttpAdapter, ServiceDeps, WebhookSubscription, WebhookDelivery } from '../types/zapier.types.js';
import { ZapierError } from '../types/zapier.types.js';

function makeDb(): DbAdapter {
  return {
    query: vi.fn(),
    execute: vi.fn(),
  };
}

function makeHttp(): HttpAdapter {
  return {
    post: vi.fn(),
  };
}

function makeDeps(db: DbAdapter, http: HttpAdapter): ServiceDeps {
  return { db, http };
}

function makeSubscription(overrides?: Partial<WebhookSubscription>): WebhookSubscription {
  return {
    id: 'sub-1',
    organizerId: 'org-1',
    targetUrl: 'https://hooks.zapier.com/catch/abc',
    triggerEvent: 'order.completed',
    secret: 'my-secret',
    isActive: true,
    createdAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('subscribeWebhook', () => {
  it('inserts a new subscription and returns it', async () => {
    const db = makeDb();
    const http = makeHttp();
    vi.mocked(db.execute).mockResolvedValue(undefined);

    const result = await subscribeWebhook(
      {
        organizerId: 'org-1',
        targetUrl: 'https://hooks.zapier.com/catch/abc',
        triggerEvent: 'order.completed',
        secret: 'secret123',
      },
      makeDeps(db, http),
    );

    expect(db.execute).toHaveBeenCalledOnce();
    expect(result.organizerId).toBe('org-1');
    expect(result.targetUrl).toBe('https://hooks.zapier.com/catch/abc');
    expect(result.triggerEvent).toBe('order.completed');
    expect(result.secret).toBe('secret123');
    expect(result.isActive).toBe(true);
    expect(result.id).toBeTruthy();
  });

  it('passes all fields to the db INSERT', async () => {
    const db = makeDb();
    vi.mocked(db.execute).mockResolvedValue(undefined);

    await subscribeWebhook(
      { organizerId: 'org-2', targetUrl: 'https://example.com', triggerEvent: 'event.published', secret: 'shhh' },
      makeDeps(db, makeHttp()),
    );

    const [sql, params] = vi.mocked(db.execute).mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO webhook_subscriptions/i);
    expect(params).toContain('org-2');
    expect(params).toContain('https://example.com');
    expect(params).toContain('event.published');
    expect(params).toContain('shhh');
  });
});

describe('unsubscribeWebhook', () => {
  it('sets isActive=false for an existing subscription', async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue([makeSubscription()]);
    vi.mocked(db.execute).mockResolvedValue(undefined);

    await unsubscribeWebhook('sub-1', 'org-1', makeDeps(db, makeHttp()));

    expect(db.execute).toHaveBeenCalledOnce();
    const [sql, params] = vi.mocked(db.execute).mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/is_active\s*=\s*false/i);
    expect(params).toContain('sub-1');
  });

  it('throws SUBSCRIPTION_NOT_FOUND when subscription is missing', async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue([]);

    await expect(
      unsubscribeWebhook('non-existent', 'org-1', makeDeps(db, makeHttp())),
    ).rejects.toThrow(ZapierError);
  });

  it('throws SUBSCRIPTION_NOT_FOUND when organizer does not match', async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue([]);

    const err = await unsubscribeWebhook('sub-1', 'wrong-org', makeDeps(db, makeHttp())).catch((e) => e);
    expect(err).toBeInstanceOf(ZapierError);
    expect((err as ZapierError).code).toBe('SUBSCRIPTION_NOT_FOUND');
  });
});

describe('deliverEvent', () => {
  it('POSTs payload with correct HMAC-SHA256 signature header', async () => {
    const db = makeDb();
    const http = makeHttp();
    const secret = 'my-secret';
    const payload = { orderId: '123', total: 99 };

    vi.mocked(db.query).mockResolvedValue([makeSubscription({ secret })]);
    vi.mocked(db.execute).mockResolvedValue(undefined);
    vi.mocked(http.post).mockResolvedValue({ status: 200, ok: true });

    await deliverEvent('sub-1', payload, makeDeps(db, http));

    const [_url, _body, headers] = vi.mocked(http.post).mock.calls[0] as [string, unknown, Record<string, string>];
    const expectedSig = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    expect(headers['X-Tixly-Signature']).toBe(expectedSig);
  });

  it('returns a delivery record with status=delivered on success', async () => {
    const db = makeDb();
    const http = makeHttp();

    vi.mocked(db.query).mockResolvedValue([makeSubscription()]);
    vi.mocked(db.execute).mockResolvedValue(undefined);
    vi.mocked(http.post).mockResolvedValue({ status: 200, ok: true });

    const delivery = await deliverEvent('sub-1', { foo: 'bar' }, makeDeps(db, http));

    expect(delivery.status).toBe('delivered');
    expect(delivery.responseCode).toBe(200);
    expect(delivery.errorMessage).toBeNull();
    expect(delivery.attempts).toBe(1);
  });

  it('returns status=retrying on HTTP failure', async () => {
    const db = makeDb();
    const http = makeHttp();

    vi.mocked(db.query).mockResolvedValue([makeSubscription()]);
    vi.mocked(db.execute).mockResolvedValue(undefined);
    vi.mocked(http.post).mockResolvedValue({ status: 500, ok: false });

    const delivery = await deliverEvent('sub-1', { foo: 'bar' }, makeDeps(db, http));

    expect(delivery.status).toBe('retrying');
    expect(delivery.nextRetryAt).not.toBeNull();
  });

  it('throws SUBSCRIPTION_NOT_FOUND for inactive/missing subscription', async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue([]);

    await expect(
      deliverEvent('bad-sub', { x: 1 }, makeDeps(db, makeHttp())),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_FOUND' });
  });

  it('sets Content-Type header to application/json', async () => {
    const db = makeDb();
    const http = makeHttp();

    vi.mocked(db.query).mockResolvedValue([makeSubscription()]);
    vi.mocked(db.execute).mockResolvedValue(undefined);
    vi.mocked(http.post).mockResolvedValue({ status: 200, ok: true });

    await deliverEvent('sub-1', { test: true }, makeDeps(db, http));

    const [_url, _body, headers] = vi.mocked(http.post).mock.calls[0] as [string, unknown, Record<string, string>];
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('retryFailedDeliveries', () => {
  function makeDelivery(overrides?: Partial<WebhookDelivery & { target_url: string; secret: string }>) {
    return {
      id: 'del-1',
      subscriptionId: 'sub-1',
      payload: { orderId: '42' },
      status: 'retrying' as const,
      attempts: 1,
      lastAttemptAt: new Date(),
      nextRetryAt: new Date(Date.now() - 1000),
      responseCode: 500,
      errorMessage: 'HTTP 500',
      createdAt: new Date(),
      target_url: 'https://hooks.zapier.com/catch/abc',
      secret: 'secret',
      ...overrides,
    };
  }

  it('marks delivery as delivered on successful retry', async () => {
    const db = makeDb();
    const http = makeHttp();

    vi.mocked(db.query).mockResolvedValue([makeDelivery()]);
    vi.mocked(db.execute).mockResolvedValue(undefined);
    vi.mocked(http.post).mockResolvedValue({ status: 200, ok: true });

    await retryFailedDeliveries(makeDeps(db, http));

    const [sql, params] = vi.mocked(db.execute).mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/UPDATE webhook_deliveries/i);
    expect(params).toContain('delivered');
  });

  it('increments attempt count on retry', async () => {
    const db = makeDb();
    const http = makeHttp();

    vi.mocked(db.query).mockResolvedValue([makeDelivery({ attempts: 2 })]);
    vi.mocked(db.execute).mockResolvedValue(undefined);
    vi.mocked(http.post).mockResolvedValue({ status: 200, ok: true });

    await retryFailedDeliveries(makeDeps(db, http));

    const [_sql, params] = vi.mocked(db.execute).mock.calls[0] as [string, unknown[]];
    expect(params).toContain(3);
  });

  it('marks delivery as failed after 5 attempts', async () => {
    const db = makeDb();
    const http = makeHttp();

    vi.mocked(db.query).mockResolvedValue([makeDelivery({ attempts: 5 })]);
    vi.mocked(db.execute).mockResolvedValue(undefined);

    await retryFailedDeliveries(makeDeps(db, http));

    // Should not call http.post for max-attempt deliveries
    expect(http.post).not.toHaveBeenCalled();
    const [sql, params] = vi.mocked(db.execute).mock.calls[0] as [string, unknown[]];
    expect(params).toContain('failed');
  });

  it('applies exponential backoff for nextRetryAt', async () => {
    const db = makeDb();
    const http = makeHttp();
    const before = Date.now();

    vi.mocked(db.query).mockResolvedValue([makeDelivery({ attempts: 2 })]);
    vi.mocked(db.execute).mockResolvedValue(undefined);
    vi.mocked(http.post).mockResolvedValue({ status: 503, ok: false });

    await retryFailedDeliveries(makeDeps(db, http));

    // attempts=2, after retry attempts=3, backoff = 2^3 = 8 minutes
    const [_sql, params] = vi.mocked(db.execute).mock.calls[0] as [string, unknown[]];
    const nextRetry = params.find((p) => p instanceof Date && (p as Date).getTime() > before) as Date | undefined;
    expect(nextRetry).toBeDefined();
    const diffMinutes = ((nextRetry as Date).getTime() - before) / 60000;
    expect(diffMinutes).toBeGreaterThanOrEqual(7.9);
    expect(diffMinutes).toBeLessThan(9);
  });

  it('does nothing when no deliveries are due', async () => {
    const db = makeDb();
    const http = makeHttp();

    vi.mocked(db.query).mockResolvedValue([]);

    await retryFailedDeliveries(makeDeps(db, http));

    expect(http.post).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });
});
