import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock next/server (hoisted before all imports) ───────────────────────────

vi.mock('next/server', () => {
  class NextRequest {
    private _headers: Map<string, string>;
    private _body: unknown;

    constructor(
      public readonly url: string,
      options?: { method?: string; headers?: Record<string, string>; body?: string },
    ) {
      this._headers = new Map(Object.entries(options?.headers ?? {}));
      this._body = options?.body ? JSON.parse(options.body) : undefined;
    }

    get headers() {
      const headers = this._headers;
      return {
        get: (name: string) => headers.get(name) ?? null,
      };
    }

    async json() {
      if (this._body === undefined) throw new Error('No body');
      return this._body;
    }
  }

  class NextResponse {
    constructor(
      public readonly body: unknown,
      public readonly status: number,
    ) {}

    static json(body: unknown, init?: { status?: number }) {
      return new NextResponse(body, init?.status ?? 200);
    }
  }

  return { NextRequest, NextResponse };
});

// ─── Mock orchestrator ───────────────────────────────────────────────────────

vi.mock('../services/tracking-orchestrator.service.js', () => ({
  handleOrderCompleted: vi.fn().mockResolvedValue(undefined),
  handlePageViewed: vi.fn().mockResolvedValue(undefined),
  handleOrderCreated: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock DLQ retry job ──────────────────────────────────────────────────────

vi.mock('../jobs/dlq-retry.job.js', () => ({
  runDlqRetry: vi.fn().mockResolvedValue({ total: 5, succeeded: 3, failed: 2 }),
}));

// ─── Imports (must come after vi.mock) ───────────────────────────────────────

import { POST as eventsPost } from '../app/api/tracking/events/route.js';
import { GET as healthGet } from '../app/api/tracking/health/route.js';
import { POST as dlqRetryPost } from '../app/api/tracking/dlq/retry/route.js';
import { GET as statsGet } from '../app/api/tracking/stats/route.js';
import * as orchestrator from '../services/tracking-orchestrator.service.js';
import { runDlqRetry } from '../jobs/dlq-retry.job.js';
import { NextRequest } from 'next/server';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createRequest(
  url: string,
  options?: { method?: string; headers?: Record<string, string>; body?: string },
) {
  return new NextRequest(url, options) as any;
}

const API_KEY = 'test-secret-key';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /api/tracking/events', () => {
  beforeEach(() => {
    process.env['INTERNAL_API_KEY'] = API_KEY;
  });

  afterEach(() => {
    delete process.env['INTERNAL_API_KEY'];
    vi.clearAllMocks();
  });

  it('should return 401 when no API key is provided', async () => {
    const req = createRequest('http://localhost/api/tracking/events', {
      method: 'POST',
      body: JSON.stringify({ type: 'OrderCompleted', payload: {} }),
    });

    const res = await eventsPost(req);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('should return 401 when API key is incorrect', async () => {
    const req = createRequest('http://localhost/api/tracking/events', {
      method: 'POST',
      headers: { 'x-api-key': 'wrong-key' },
      body: JSON.stringify({ type: 'OrderCompleted', payload: {} }),
    });

    const res = await eventsPost(req);
    expect(res.status).toBe(401);
  });

  it('should return 400 for invalid JSON body', async () => {
    const req = createRequest('http://localhost/api/tracking/events', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
    });

    const res = await eventsPost(req);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid JSON body' });
  });

  it('should return 400 for invalid event type', async () => {
    const req = createRequest('http://localhost/api/tracking/events', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
      body: JSON.stringify({ type: 'InvalidType', payload: {} }),
    });

    const res = await eventsPost(req);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid event type');
  });

  it('should return 400 when payload is missing', async () => {
    const req = createRequest('http://localhost/api/tracking/events', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
      body: JSON.stringify({ type: 'OrderCompleted' }),
    });

    const res = await eventsPost(req);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing or invalid payload');
  });

  it('should call handleOrderCompleted for OrderCompleted type', async () => {
    const payload = {
      orderId: 'order-1',
      eventId: 'event-1',
      eventName: 'Test Event',
      totalAmount: 1000,
      currency: 'CZK',
      quantity: 2,
      eventPageUrl: 'https://example.com',
      userEmail: 'test@example.com',
      userIp: '1.2.3.4',
      userAgent: 'Test Agent',
      sessionId: 'sess-1',
      occurredAt: '2024-04-05T00:00:00.000Z',
    };

    const req = createRequest('http://localhost/api/tracking/events', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
      body: JSON.stringify({ type: 'OrderCompleted', payload }),
    });

    const res = await eventsPost(req);
    expect(res.status).toBe(202);
    expect(res.body.message).toBe('Event processed successfully');
    expect(res.body.type).toBe('OrderCompleted');
    expect(orchestrator.handleOrderCompleted).toHaveBeenCalled();
  });

  it('should call handlePageViewed for PageViewed type', async () => {
    const payload = {
      sessionId: 'sess-1',
      eventId: 'event-1',
      eventName: 'Test Event',
      pageType: 'event_detail',
      pageUrl: 'https://example.com/event',
      currency: 'CZK',
      userIp: '1.2.3.4',
      userAgent: 'Test Agent',
      occurredAt: '2024-04-05T00:00:00.000Z',
    };

    const req = createRequest('http://localhost/api/tracking/events', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
      body: JSON.stringify({ type: 'PageViewed', payload }),
    });

    const res = await eventsPost(req);
    expect(res.status).toBe(202);
    expect(orchestrator.handlePageViewed).toHaveBeenCalled();
  });

  it('should call handleOrderCreated for OrderCreated type', async () => {
    const payload = {
      orderId: 'order-2',
      eventId: 'event-1',
      eventName: 'Test Event',
      totalAmount: 1500,
      currency: 'CZK',
      quantity: 3,
      eventPageUrl: 'https://example.com',
      userEmail: 'test@example.com',
      userIp: '1.2.3.4',
      userAgent: 'Test Agent',
      sessionId: 'sess-2',
      occurredAt: '2024-04-05T00:00:00.000Z',
    };

    const req = createRequest('http://localhost/api/tracking/events', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
      body: JSON.stringify({ type: 'OrderCreated', payload }),
    });

    const res = await eventsPost(req);
    expect(res.status).toBe(202);
    expect(orchestrator.handleOrderCreated).toHaveBeenCalled();
  });

  it('should return 401 when INTERNAL_API_KEY is not configured', async () => {
    delete process.env['INTERNAL_API_KEY'];

    const req = createRequest('http://localhost/api/tracking/events', {
      method: 'POST',
      headers: { 'x-api-key': 'any-key' },
      body: JSON.stringify({ type: 'OrderCompleted', payload: {} }),
    });

    const res = await eventsPost(req);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/tracking/health', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env['META_PIXEL_ID'];
    delete process.env['META_ACCESS_TOKEN'];
    delete process.env['TIKTOK_PIXEL_CODE'];
    delete process.env['TIKTOK_ACCESS_TOKEN'];
    delete process.env['KAFKA_BROKERS'];
  });

  it('should return health status with degraded when no deps injected', async () => {
    const req = createRequest('http://localhost/api/tracking/health');

    const res = await healthGet(req);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.services).toBeDefined();
  });

  it('should report meta_api as configured when env vars are set', async () => {
    process.env['META_PIXEL_ID'] = 'pixel123';
    process.env['META_ACCESS_TOKEN'] = 'token123';

    const req = createRequest('http://localhost/api/tracking/health');

    const res = await healthGet(req);
    expect(res.body.services.meta_api).toBe('configured');
  });

  it('should report meta_api as not_configured when env vars are missing', async () => {
    const req = createRequest('http://localhost/api/tracking/health');

    const res = await healthGet(req);
    expect(res.body.services.meta_api).toBe('not_configured');
  });

  it('should report tiktok_api as configured when env vars are set', async () => {
    process.env['TIKTOK_PIXEL_CODE'] = 'pixel456';
    process.env['TIKTOK_ACCESS_TOKEN'] = 'token456';

    const req = createRequest('http://localhost/api/tracking/health');

    const res = await healthGet(req);
    expect(res.body.services.tiktok_api).toBe('configured');
  });

  it('should report kafka as configured when KAFKA_BROKERS is set', async () => {
    process.env['KAFKA_BROKERS'] = 'localhost:9092';

    const req = createRequest('http://localhost/api/tracking/health');

    const res = await healthGet(req);
    expect(res.body.services.kafka).toBe('configured');
  });

  it('should report redis and database as down when no deps injected', async () => {
    const req = createRequest('http://localhost/api/tracking/health');

    const res = await healthGet(req);
    expect(res.body.services.redis).toBe('down');
    expect(res.body.services.database).toBe('down');
  });
});

describe('POST /api/tracking/dlq/retry', () => {
  beforeEach(() => {
    process.env['INTERNAL_API_KEY'] = API_KEY;
  });

  afterEach(() => {
    delete process.env['INTERNAL_API_KEY'];
    vi.clearAllMocks();
  });

  it('should return 401 when no API key is provided', async () => {
    const req = createRequest('http://localhost/api/tracking/dlq/retry', {
      method: 'POST',
    });

    const res = await dlqRetryPost(req);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('should return 401 when API key is incorrect', async () => {
    const req = createRequest('http://localhost/api/tracking/dlq/retry', {
      method: 'POST',
      headers: { 'x-api-key': 'wrong-key' },
    });

    const res = await dlqRetryPost(req);
    expect(res.status).toBe(401);
  });

  it('should trigger DLQ retry and return results', async () => {
    const req = createRequest('http://localhost/api/tracking/dlq/retry', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
    });

    const res = await dlqRetryPost(req);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'DLQ retry completed',
      total: 5,
      succeeded: 3,
      failed: 2,
    });
    expect(runDlqRetry).toHaveBeenCalled();
  });

  it('should return 500 when DLQ retry throws', async () => {
    vi.mocked(runDlqRetry).mockRejectedValueOnce(new Error('Database connection lost'));

    const req = createRequest('http://localhost/api/tracking/dlq/retry', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
    });

    const res = await dlqRetryPost(req);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DLQ retry failed');
    expect(res.body.detail).toBe('Database connection lost');
  });
});

describe('GET /api/tracking/stats', () => {
  beforeEach(() => {
    process.env['INTERNAL_API_KEY'] = API_KEY;
  });

  afterEach(() => {
    delete process.env['INTERNAL_API_KEY'];
    delete process.env['META_PIXEL_ID'];
    delete process.env['META_ACCESS_TOKEN'];
    delete process.env['TIKTOK_PIXEL_CODE'];
    delete process.env['TIKTOK_ACCESS_TOKEN'];
    delete process.env['KAFKA_BROKERS'];
    vi.clearAllMocks();
  });

  it('should return 401 when no API key is provided', async () => {
    const req = createRequest('http://localhost/api/tracking/stats');

    const res = await statsGet(req);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('should return 401 when API key is incorrect', async () => {
    const req = createRequest('http://localhost/api/tracking/stats', {
      headers: { 'x-api-key': 'wrong-key' },
    });

    const res = await statsGet(req);
    expect(res.status).toBe(401);
  });

  it('should return stats with configuration status', async () => {
    process.env['META_PIXEL_ID'] = 'pixel123';
    process.env['META_ACCESS_TOKEN'] = 'token123';
    process.env['TIKTOK_PIXEL_CODE'] = 'pixel456';
    process.env['TIKTOK_ACCESS_TOKEN'] = 'token456';
    process.env['KAFKA_BROKERS'] = 'localhost:9092';

    const req = createRequest('http://localhost/api/tracking/stats', {
      headers: { 'x-api-key': API_KEY },
    });

    const res = await statsGet(req);
    expect(res.status).toBe(200);
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.configuration).toEqual({
      meta_configured: true,
      tiktok_configured: true,
      kafka_configured: true,
    });
  });

  it('should report unconfigured services correctly', async () => {
    const req = createRequest('http://localhost/api/tracking/stats', {
      headers: { 'x-api-key': API_KEY },
    });

    const res = await statsGet(req);
    expect(res.status).toBe(200);
    expect(res.body.configuration.meta_configured).toBe(false);
    expect(res.body.configuration.tiktok_configured).toBe(false);
    expect(res.body.configuration.kafka_configured).toBe(false);
  });
});
