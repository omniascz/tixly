import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BulkGateClient,
  BulkGateError,
  BULKGATE_ERROR_CODES,
  DLR_STATUS_MAP,
  loadBulkGateConfig,
} from './bulkgate.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  applicationId: 'test-app-id',
  applicationToken: 'test-token',
};

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ─── sendSingle ─────────────────────────────────────────────────────────────

describe('BulkGateClient.sendSingle', () => {
  it('sends correct payload to /simple/transactional', async () => {
    const fetchMock = mockFetchResponse({
      data: { sms_id: 'sms-123', status: 'accepted', price: '0.035' },
    });
    globalThis.fetch = fetchMock;

    const client = new BulkGateClient(DEFAULT_CONFIG);
    await client.sendSingle('+420601123456', 'Hello');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://portal.bulkgate.com/api/1.0/simple/transactional');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body.application_id).toBe('test-app-id');
    expect(body.application_token).toBe('test-token');
    expect(body.number).toBe('420601123456'); // stripped +
    expect(body.text).toBe('Hello');
    expect(body.unicode).toBe(0);
  });

  it('sets unicode=1 for non-GSM7 text', async () => {
    globalThis.fetch = mockFetchResponse({
      data: { sms_id: 'sms-1', status: 'accepted' },
    });

    const client = new BulkGateClient(DEFAULT_CONFIG);
    await client.sendSingle('+420601123456', 'Příliš žluťoučký');

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
    expect(body.unicode).toBe(1);
  });

  it('returns parsed result with price', async () => {
    globalThis.fetch = mockFetchResponse({
      data: { sms_id: 'sms-456', status: 'accepted', price: '0.042' },
    });

    const client = new BulkGateClient(DEFAULT_CONFIG);
    const result = await client.sendSingle('+420601123456', 'Test');

    expect(result.smsId).toBe('sms-456');
    expect(result.status).toBe('accepted');
    expect(result.price).toBe(0.042);
  });

  it('returns null price when missing', async () => {
    globalThis.fetch = mockFetchResponse({
      data: { sms_id: 'sms-789', status: 'accepted' },
    });

    const client = new BulkGateClient(DEFAULT_CONFIG);
    const result = await client.sendSingle('+420601123456', 'Test');

    expect(result.price).toBeNull();
  });

  it('includes senderId and senderIdValue in payload', async () => {
    globalThis.fetch = mockFetchResponse({
      data: { sms_id: 'sms-1', status: 'accepted' },
    });

    const client = new BulkGateClient({
      ...DEFAULT_CONFIG,
      senderId: 'gText',
      senderIdValue: 'MyApp',
    });
    await client.sendSingle('+420601123456', 'Test');

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
    expect(body.sender_id).toBe('gText');
    expect(body.sender_id_value).toBe('MyApp');
  });

  it('truncates senderIdValue to 11 chars', async () => {
    globalThis.fetch = mockFetchResponse({
      data: { sms_id: 'sms-1', status: 'accepted' },
    });

    const client = new BulkGateClient({
      ...DEFAULT_CONFIG,
      senderId: 'gText',
      senderIdValue: 'VeryLongSenderName',
    });
    await client.sendSingle('+420601123456', 'Test');

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
    expect(body.sender_id_value).toBe('VeryLongSen'); // 11 chars
  });

  it('includes dlr_url when configured', async () => {
    globalThis.fetch = mockFetchResponse({
      data: { sms_id: 'sms-1', status: 'accepted' },
    });

    const client = new BulkGateClient({
      ...DEFAULT_CONFIG,
      dlrBaseUrl: 'https://example.com/webhook',
    });
    await client.sendSingle('+420601123456', 'Test');

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
    expect(body.dlr_url).toBe('https://example.com/webhook');
  });

  it('uses custom apiBaseUrl', async () => {
    globalThis.fetch = mockFetchResponse({
      data: { sms_id: 'sms-1', status: 'accepted' },
    });

    const client = new BulkGateClient({
      ...DEFAULT_CONFIG,
      apiBaseUrl: 'https://custom.bulkgate.com/api/2.0',
    });
    await client.sendSingle('+420601123456', 'Test');

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://custom.bulkgate.com/api/2.0/simple/transactional');
  });

  it('throws BulkGateError on API error response', async () => {
    globalThis.fetch = mockFetchResponse({
      data: { error: 'Invalid number', error_code: 13 },
    });

    const client = new BulkGateClient(DEFAULT_CONFIG);

    await expect(client.sendSingle('+420601123456', 'Test'))
      .rejects.toThrow(BulkGateError);

    try {
      await client.sendSingle('+420601123456', 'Test');
    } catch (err) {
      const e = err as BulkGateError;
      expect(e.code).toBe('INVALID_NUMBER');
      expect(e.retryable).toBe(false);
    }
  });

  it('throws BulkGateError on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const client = new BulkGateClient(DEFAULT_CONFIG);

    await expect(client.sendSingle('+420601123456', 'Test'))
      .rejects.toThrow(BulkGateError);

    try {
      await client.sendSingle('+420601123456', 'Test');
    } catch (err) {
      const e = err as BulkGateError;
      expect(e.code).toBe('NETWORK_ERROR');
      expect(e.retryable).toBe(true);
    }
  });

  it('throws on HTTP 401 as NOT_CONFIGURED', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    const client = new BulkGateClient(DEFAULT_CONFIG);

    try {
      await client.sendSingle('+420601123456', 'Test');
    } catch (err) {
      const e = err as BulkGateError;
      expect(e.code).toBe('NOT_CONFIGURED');
      expect(e.retryable).toBe(false);
    }
  });

  it('throws on HTTP 429 as RATE_LIMITED', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Too many requests'),
    });

    const client = new BulkGateClient(DEFAULT_CONFIG);

    try {
      await client.sendSingle('+420601123456', 'Test');
    } catch (err) {
      const e = err as BulkGateError;
      expect(e.code).toBe('RATE_LIMITED');
      expect(e.retryable).toBe(true);
    }
  });

  it('throws on HTTP 402 as INSUFFICIENT_CREDITS', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: () => Promise.resolve('Payment required'),
    });

    const client = new BulkGateClient(DEFAULT_CONFIG);

    try {
      await client.sendSingle('+420601123456', 'Test');
    } catch (err) {
      const e = err as BulkGateError;
      expect(e.code).toBe('INSUFFICIENT_CREDITS');
      expect(e.retryable).toBe(true);
    }
  });
});

// ─── sendBulk ───────────────────────────────────────────────────────────────

describe('BulkGateClient.sendBulk', () => {
  it('returns empty result for empty phones array', async () => {
    const client = new BulkGateClient(DEFAULT_CONFIG);
    const result = await client.sendBulk([], 'Test');

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('sends correct payload to /advanced/transactional', async () => {
    const fetchMock = mockFetchResponse({
      data: {
        response: [
          { sms_id: 'sms-1', status: 'accepted' },
          { sms_id: 'sms-2', status: 'accepted' },
        ],
      },
    });
    globalThis.fetch = fetchMock;

    const client = new BulkGateClient(DEFAULT_CONFIG);
    await client.sendBulk(['+420601111111', '+420602222222'], 'Hello bulk');

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].number).toBe('420601111111');
    expect(body.messages[1].number).toBe('420602222222');
    expect(body.messages[0].text).toBe('Hello bulk');
  });

  it('separates accepted and rejected phones', async () => {
    globalThis.fetch = mockFetchResponse({
      data: {
        response: [
          { sms_id: 'sms-1', status: 'accepted' },
          { status: 'error', error: 'Blacklisted' },
          { sms_id: 'sms-3', status: 'sent' },
        ],
      },
    });

    const client = new BulkGateClient(DEFAULT_CONFIG);
    const result = await client.sendBulk(
      ['+420601111111', '+420602222222', '+420603333333'],
      'Test',
    );

    expect(result.accepted).toEqual(['+420601111111', '+420603333333']);
    expect(result.rejected).toEqual([
      { phone: '+420602222222', reason: 'Blacklisted' },
    ]);
  });

  it('rejects all on missing response', async () => {
    globalThis.fetch = mockFetchResponse({ data: {} });

    const client = new BulkGateClient(DEFAULT_CONFIG);
    const result = await client.sendBulk(['+420601111111'], 'Test');

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      { phone: '+420601111111', reason: 'provider_error' },
    ]);
  });
});

// ─── BulkGateError ──────────────────────────────────────────────────────────

describe('BulkGateError', () => {
  it('is an instance of Error', () => {
    const err = new BulkGateError('TEST', 'test message', false);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('BulkGateError');
    expect(err.message).toBe('test message');
    expect(err.code).toBe('TEST');
    expect(err.retryable).toBe(false);
  });

  it('fromHttpStatus maps 5xx as retryable', () => {
    const err = BulkGateError.fromHttpStatus(500, 'Server error');
    expect(err.code).toBe('PROVIDER_ERROR');
    expect(err.retryable).toBe(true);
  });

  it('fromHttpStatus maps 4xx (non-special) as non-retryable', () => {
    const err = BulkGateError.fromHttpStatus(400, 'Bad request');
    expect(err.code).toBe('PROVIDER_ERROR');
    expect(err.retryable).toBe(false);
  });
});

// ─── Constants ──────────────────────────────────────────────────────────────

describe('BULKGATE_ERROR_CODES', () => {
  it('maps known error codes', () => {
    expect(BULKGATE_ERROR_CODES[13]!.code).toBe('INVALID_NUMBER');
    expect(BULKGATE_ERROR_CODES[14]!.code).toBe('BLACKLISTED');
    expect(BULKGATE_ERROR_CODES[20]!.code).toBe('INSUFFICIENT_CREDITS');
    expect(BULKGATE_ERROR_CODES[28]!.code).toBe('DAILY_LIMIT');
    expect(BULKGATE_ERROR_CODES[30]!.code).toBe('SENDER_BLOCKED');
  });
});

describe('DLR_STATUS_MAP', () => {
  it('maps all known statuses', () => {
    expect(DLR_STATUS_MAP['delivered']).toBe('delivered');
    expect(DLR_STATUS_MAP['undelivered']).toBe('failed');
    expect(DLR_STATUS_MAP['expired']).toBe('failed');
    expect(DLR_STATUS_MAP['rejected']).toBe('failed');
    expect(DLR_STATUS_MAP['accepted']).toBe('sent');
    expect(DLR_STATUS_MAP['buffered']).toBe('queued');
  });
});

// ─── loadBulkGateConfig ─────────────────────────────────────────────────────

describe('loadBulkGateConfig', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns null when env vars missing', () => {
    delete process.env.BULKGATE_APP_ID;
    delete process.env.BULKGATE_APP_TOKEN;
    expect(loadBulkGateConfig()).toBeNull();
  });

  it('returns null when only APP_ID set', () => {
    process.env.BULKGATE_APP_ID = 'id';
    delete process.env.BULKGATE_APP_TOKEN;
    expect(loadBulkGateConfig()).toBeNull();
  });

  it('returns config when both env vars set', () => {
    process.env.BULKGATE_APP_ID = 'my-app';
    process.env.BULKGATE_APP_TOKEN = 'my-token';
    delete process.env.BULKGATE_API_BASE_URL;
    delete process.env.BULKGATE_SENDER_ID;
    delete process.env.BULKGATE_SENDER_ID_VALUE;

    const config = loadBulkGateConfig();
    expect(config).not.toBeNull();
    expect(config!.applicationId).toBe('my-app');
    expect(config!.applicationToken).toBe('my-token');
    expect(config!.apiBaseUrl).toBe('https://portal.bulkgate.com/api/1.0');
    expect(config!.senderId).toBe('gText');
  });

  it('reads optional env vars', () => {
    process.env.BULKGATE_APP_ID = 'id';
    process.env.BULKGATE_APP_TOKEN = 'token';
    process.env.BULKGATE_API_BASE_URL = 'https://custom.api';
    process.env.BULKGATE_SENDER_ID = 'gOwn';
    process.env.BULKGATE_SENDER_ID_VALUE = 'MyBrand';

    const config = loadBulkGateConfig()!;
    expect(config.apiBaseUrl).toBe('https://custom.api');
    expect(config.senderId).toBe('gOwn');
    expect(config.senderIdValue).toBe('MyBrand');
  });
});
