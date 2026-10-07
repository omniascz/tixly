// @vitest-environment node
/**
 * Kolo 14 / krok 2 — nápor při spuštění prodeje: když aplikaci dojdou spojení do DB (fronta poolu > connectionTimeout,
 * nebo PgBouncer/DB nepřijme spojení včas), nákupní cesta odpoví ŘÍZENĚ 503 s Retry-After (prohlížeč / GoPay to
 * zkusí znovu), ne 500. Platí pro plánek, hold, checkout míst a webhook brány. Bez DB (pool je mock).
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const failure = { err: new Error('timeout exceeded when trying to connect') };
vi.mock('@/lib/db/rls-pool', () => {
  const reject = () => Promise.reject(failure.err);
  const fake = { query: reject, connect: reject };
  return {
    db: () => fake,
    runWithServiceContext: <T>(fn: () => Promise<T>) => fn(),
    runWithPromoterContext: <T>(_p: string, fn: () => Promise<T>) => fn(),
  };
});
vi.mock('@/lib/payment/gopay-real', () => ({
  getGopayConfig: () => ({ isConfigured: true }),
  getGopayPaymentStatus: async () => ({ state: 'PAID', paid: true, amount: 45000, currency: 'CZK' }),
}));

const EV = '11111111-2222-4333-8444-555555555555';
const SEAT = '11111111-2222-4333-8444-666666666666';
const json = (url: string, body: unknown) => new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '10.9.9.9' }, body: JSON.stringify(body) });

async function expectBusy(res: Response): Promise<void> {
  expect(res.status).toBe(503);
  expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  const j = (await res.json()) as { error?: string };
  expect(j.error).toBe('BUSY');
}

describe.each([
  ['fronta poolu', 'timeout exceeded when trying to connect'],
  ['spojení do DB', 'Connection terminated due to connection timeout'],
])('přetížení (%s) → 503 Retry-After', (_label, message) => {
  beforeEach(() => { failure.err = new Error(message); });

  it('plánek GET /api/events/[id]/seats', async () => {
    const { GET } = await import('@/app/api/events/[id]/seats/route');
    await expectBusy(await GET(new NextRequest(`http://localhost/api/events/${EV}/seats`), { params: { id: EV } }));
  });
  it('hold POST /api/events/[id]/seats/hold', async () => {
    const { POST } = await import('@/app/api/events/[id]/seats/hold/route');
    await expectBusy(await POST(json(`http://localhost/api/events/${EV}/seats/hold`, { seatIds: [SEAT] }), { params: { id: EV } }));
  });
  it('checkout POST /api/checkout/seats', async () => {
    const { POST } = await import('@/app/api/checkout/seats/route');
    await expectBusy(await POST(json('http://localhost/api/checkout/seats', {
      eventId: EV, seatHoldToken: SEAT, items: [{ seatId: SEAT, categoryId: SEAT }], buyerEmail: 'a@b.test', buyerName: 'A',
    })));
  });
  it('webhook GET /api/payments/gopay/webhook', async () => {
    const { GET } = await import('@/app/api/payments/gopay/webhook/route');
    await expectBusy(await GET(new NextRequest('http://localhost/api/payments/gopay/webhook?id=123')));
  });
});

describe('jiná chyba DB zůstává chybou (žádné maskování)', () => {
  it('hold s obecnou chybou neodpoví 503', async () => {
    failure.err = new Error('relation "catalog.event_seats" does not exist');
    const { POST } = await import('@/app/api/events/[id]/seats/hold/route');
    const res = await POST(json(`http://localhost/api/events/${EV}/seats/hold`, { seatIds: [SEAT] }), { params: { id: EV } }).catch(() => null);
    expect(res?.status ?? 500).not.toBe(503);
  });
});
