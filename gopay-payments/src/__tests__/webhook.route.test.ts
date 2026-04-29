// =============================================================================
// Testy pro GoPay webhook route (A12 + A13)
//
// A12: outer catch vrací 500 → GoPay může retry při DB výpadku
// A13: GOPAY_WEBHOOK_IP_ALLOWLIST env var — 403 pro neznámé IP
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks musí být před importem testovaného modulu (vitest hoist)
vi.mock('../services/gopay-payment.service.js', () => ({
  handleGopayWebhook: vi.fn(),
}));

vi.mock('../lib/service-container.js', () => ({
  getServiceDeps: vi.fn(() => ({})),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      }),
  },
}));

import { POST, GET } from '../app/api/gopay/webhook/route.js';
import { handleGopayWebhook } from '../services/gopay-payment.service.js';

const mockHandleWebhook = handleGopayWebhook as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  method: 'POST' | 'GET',
  queryParams: Record<string, string> = {},
  clientIp?: string,
  body?: unknown,
): Request {
  const url = new URL('http://localhost/api/gopay/webhook');
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (clientIp) {
    headers['x-forwarded-for'] = clientIp;
  }
  return new Request(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GOPAY_WEBHOOK_IP_ALLOWLIST;
});

afterEach(() => {
  delete process.env.GOPAY_WEBHOOK_IP_ALLOWLIST;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// A12 — vrátit 500 při chybě, ne 200 (aby GoPay mohl retry)
// ---------------------------------------------------------------------------

describe('webhook route — úspěšné zpracování', () => {
  it('POST vrátí 200 { ok: true } při úspěchu', async () => {
    mockHandleWebhook.mockResolvedValue({ statusUpdated: true, newStatus: 'PAID' });

    const res = await POST(makeRequest('POST', { id: 'gp-ext-1' }));

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(mockHandleWebhook).toHaveBeenCalledTimes(1);
  });

  it('GET vrátí 200 { ok: true } při úspěchu', async () => {
    mockHandleWebhook.mockResolvedValue({ statusUpdated: false, newStatus: 'CREATED' });

    const res = await GET(makeRequest('GET', { id: 'gp-ext-1' }));

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe('webhook route — A12: chyba vrací 500 (ne 200)', () => {
  it('POST vrátí 500 když handleGopayWebhook vyhodí chybu (DB výpadek)', async () => {
    mockHandleWebhook.mockRejectedValue(new Error('connection refused'));

    const res = await POST(makeRequest('POST', { id: 'gp-ext-1' }));

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INTERNAL_ERROR');
  });

  it('GET vrátí 500 při chybě handleGopayWebhook', async () => {
    mockHandleWebhook.mockRejectedValue(new Error('DB timeout'));

    const res = await GET(makeRequest('GET', { id: 'gp-ext-1' }));

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INTERNAL_ERROR');
    // GoPay dostane 5xx → zopakuje webhook
  });

  it('chyba v POST těle (malformed JSON) nezastaví handler — re-fetch použije autoritativní stav', async () => {
    // Malformed body je ignorován v inner try/catch; handler pokračuje s re-fetch
    mockHandleWebhook.mockResolvedValue({ statusUpdated: true, newStatus: 'PAID' });

    const url = new URL('http://localhost/api/gopay/webhook?id=gp-ext-1');
    const req = new Request(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-valid-json{{{',
    });

    const res = await POST(req);
    // Handler pokračuje dál a vrátí 200 (body bylo ignorováno, re-fetch fungoval)
    expect(res.status).toBe(200);
    expect(mockHandleWebhook).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// A13 — IP allowlist
// ---------------------------------------------------------------------------

describe('webhook route — A13: IP allowlist', () => {
  it('povolí požadavek z IP na allowlistu', async () => {
    process.env.GOPAY_WEBHOOK_IP_ALLOWLIST = '94.140.206.1,46.28.103.1';
    mockHandleWebhook.mockResolvedValue({ statusUpdated: true, newStatus: 'PAID' });

    const res = await POST(makeRequest('POST', { id: 'gp-ext-1' }, '94.140.206.1'));

    expect(res.status).toBe(200);
    expect(mockHandleWebhook).toHaveBeenCalledTimes(1);
  });

  it('povolí druhou IP z allowlistu', async () => {
    process.env.GOPAY_WEBHOOK_IP_ALLOWLIST = '94.140.206.1,46.28.103.1';
    mockHandleWebhook.mockResolvedValue({ statusUpdated: false, newStatus: 'CREATED' });

    const res = await POST(makeRequest('POST', { id: 'gp-ext-1' }, '46.28.103.1'));

    expect(res.status).toBe(200);
  });

  it('zamítne požadavek z IP mimo allowlist — vrátí 403', async () => {
    process.env.GOPAY_WEBHOOK_IP_ALLOWLIST = '94.140.206.1,46.28.103.1';

    const res = await POST(makeRequest('POST', { id: 'gp-ext-1' }, '1.2.3.4'));

    expect(res.status).toBe(403);
    // handleGopayWebhook nesmí být zavolán — útočník nedostane API roundtrip
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  it('zamítne GET z neznámé IP — 403', async () => {
    process.env.GOPAY_WEBHOOK_IP_ALLOWLIST = '94.140.206.1';

    const res = await GET(makeRequest('GET', { id: 'gp-ext-1' }, '99.99.99.99'));

    expect(res.status).toBe(403);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  it('povolí všechny IP když GOPAY_WEBHOOK_IP_ALLOWLIST není nastaven (loguje varování)', async () => {
    // env var is NOT set
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockHandleWebhook.mockResolvedValue({ statusUpdated: false, newStatus: 'CREATED' });

    const res = await POST(makeRequest('POST', { id: 'gp-ext-1' }, '203.0.113.42'));

    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('GOPAY_WEBHOOK_IP_ALLOWLIST not set'),
    );
  });

  it('GET DoS vektor: neznámá IP je odmítnuta bez GoPay API roundtrip (A13)', async () => {
    // Tato verifikace je klíčová: útočník, který zná payment ID, NESMÍ způsobit
    // extra GoPay API roundtrip přes GET request z neznámé IP
    process.env.GOPAY_WEBHOOK_IP_ALLOWLIST = '94.140.206.1';

    const res = await GET(makeRequest('GET', { id: 'gp-ext-known' }, '8.8.8.8'));

    expect(res.status).toBe(403);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
    // Pokud handleGopayWebhook není zavolán, není ani gopay.getPayment → žádný roundtrip
  });
});
