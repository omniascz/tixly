import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPayload, matchesEvent, deliverWebhook } from './delivery.js';
import type { WebhookPayload, WebhookClientConfig } from './types.js';

// ---------------------------------------------------------------------------
// buildPayload
// ---------------------------------------------------------------------------

describe('buildPayload', () => {
  it('creates a payload envelope with all fields', () => {
    const p = buildPayload(
      'del-001',
      'invoice.created',
      'tenant-1',
      { invoiceId: 'inv-1' },
      'inv-1',
      '2026-04-12T10:00:00.000Z',
    );

    expect(p).toEqual({
      id: 'del-001',
      event: 'invoice.created',
      tenantId: 'tenant-1',
      resourceId: 'inv-1',
      timestamp: '2026-04-12T10:00:00.000Z',
      data: { invoiceId: 'inv-1' },
    });
  });

  it('generates timestamp when not provided', () => {
    const before = new Date().toISOString();
    const p = buildPayload('id', 'event', 'tenant', {});
    const after = new Date().toISOString();

    expect(p.timestamp).toBeDefined();
    expect(p.timestamp >= before).toBe(true);
    expect(p.timestamp <= after).toBe(true);
  });

  it('resourceId is undefined when not provided', () => {
    const p = buildPayload('id', 'event', 'tenant', {});
    expect(p.resourceId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// matchesEvent
// ---------------------------------------------------------------------------

describe('matchesEvent', () => {
  it('matches exact event type', () => {
    expect(matchesEvent(['invoice.created', 'order.paid'], 'invoice.created')).toBe(true);
  });

  it('returns false for non-matching event', () => {
    expect(matchesEvent(['invoice.created'], 'order.paid')).toBe(false);
  });

  it('wildcard * matches any event', () => {
    expect(matchesEvent(['*'], 'anything.here')).toBe(true);
  });

  it('returns false for empty events array', () => {
    expect(matchesEvent([], 'invoice.created')).toBe(false);
  });

  it('wildcard among other events still matches all', () => {
    expect(matchesEvent(['invoice.created', '*'], 'order.paid')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deliverWebhook
// ---------------------------------------------------------------------------

describe('deliverWebhook', () => {
  const mockPayload: WebhookPayload = {
    id: 'del-001',
    event: 'invoice.created',
    tenantId: 'tenant-1',
    timestamp: '2026-04-12T10:00:00.000Z',
    data: { invoiceId: 'inv-1' },
  };

  const mockSubscription = {
    url: 'https://example.com/webhook',
    secret: 'a'.repeat(64),
    timeoutMs: 5000,
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns success for 2xx response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('ok'),
    }) as unknown as typeof fetch;

    const result = await deliverWebhook(mockSubscription, 'del-001', mockPayload);

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.responseBody).toBe('ok');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns failure for 4xx/5xx response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    }) as unknown as typeof fetch;

    const result = await deliverWebhook(mockSubscription, 'del-001', mockPayload);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.responseBody).toBe('Internal Server Error');
  });

  it('returns failure on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    const result = await deliverWebhook(mockSubscription, 'del-001', mockPayload);

    expect(result.success).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
    expect(result.statusCode).toBeUndefined();
  });

  it('sends correct headers with default config', async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve({ status: 200, text: () => Promise.resolve('') });
    }) as unknown as typeof fetch;

    await deliverWebhook(mockSubscription, 'del-001', mockPayload);

    expect(capturedHeaders['Content-Type']).toBe('application/json');
    expect(capturedHeaders['X-Webhook-Event']).toBe('invoice.created');
    expect(capturedHeaders['X-Webhook-Delivery']).toBe('del-001');
    expect(capturedHeaders['X-Webhook-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(capturedHeaders['X-Webhook-Timestamp']).toBeDefined();
    expect(capturedHeaders['User-Agent']).toBe('SharedWebhooks/1.0');
  });

  it('uses custom header prefix', async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve({ status: 200, text: () => Promise.resolve('') });
    }) as unknown as typeof fetch;

    const config: WebhookClientConfig = {
      headerPrefix: 'X-ForgeMsg',
      userAgent: 'ForgeMsg/1.0',
    };

    await deliverWebhook(mockSubscription, 'del-001', mockPayload, config);

    expect(capturedHeaders['X-ForgeMsg-Event']).toBe('invoice.created');
    expect(capturedHeaders['X-ForgeMsg-Delivery']).toBe('del-001');
    expect(capturedHeaders['X-ForgeMsg-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(capturedHeaders['User-Agent']).toBe('ForgeMsg/1.0');
  });

  it('truncates response body to maxResponseBodyLength', async () => {
    const longBody = 'x'.repeat(1000);
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(longBody),
    }) as unknown as typeof fetch;

    const config: WebhookClientConfig = { maxResponseBodyLength: 100 };
    const result = await deliverWebhook(mockSubscription, 'del-001', mockPayload, config);

    expect(result.responseBody).toHaveLength(100);
  });

  it('sends JSON body with payload', async () => {
    let capturedBody: string = '';
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({ status: 200, text: () => Promise.resolve('') });
    }) as unknown as typeof fetch;

    await deliverWebhook(mockSubscription, 'del-001', mockPayload);

    const parsed = JSON.parse(capturedBody);
    expect(parsed.id).toBe('del-001');
    expect(parsed.event).toBe('invoice.created');
    expect(parsed.data).toEqual({ invoiceId: 'inv-1' });
  });
});
