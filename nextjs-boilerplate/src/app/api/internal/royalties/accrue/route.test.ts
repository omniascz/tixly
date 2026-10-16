/**
 * Test cesty peněz k umělci: zaplacená objednávka → zápis do knihy podílů.
 *
 * Tenhle test tu chyběl a je to důvod, proč se nikdo nedozvěděl, že se podíly
 * nikdy nenačítaly — endpoint vracel 401 kvůli jinému jménu proměnné s heslem
 * a volá se stylem „pošli a zapomeň".
 *
 * Mockujeme pg.Pool — ověřujeme chování endpointu, ne SQL.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const dataQuery = vi.fn();
const mockClient = {
  query: vi.fn((sql: string, params?: unknown[]) => {
    const s = String(sql).trim().toUpperCase();
    if (s.startsWith('SET') || s.startsWith('RESET') || s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') {
      return Promise.resolve({ rows: [] });
    }
    return dataQuery(sql, params);
  }),
  release: vi.fn(),
};
const mockPool = { connect: vi.fn(async () => mockClient) };

vi.mock('pg', () => ({ Pool: vi.fn(() => mockPool) }));

import { POST } from './route';

const TOKEN = 'testovaci-heslo';

function makeReq(body: unknown, token?: string): import('next/server').NextRequest {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers['x-internal-token'] = token;
  return {
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as import('next/server').NextRequest;
}

const PAID_ORDER = {
  id: 'order-1',
  event_id: 'event-1',
  status: 'paid',
  total_revenue: 100_000, // 1000 Kč v haléřích
  total_tickets: 2,
};

const AGREEMENT = {
  id: 'agr-1',
  royalty_type: 'percent',
  percent_rate: 20,
  flat_amount_halire: null,
  per_ticket_halire: null,
  min_guarantee_halire: null,
  cap_halire: null,
  included_ticket_type_ids: null,
};

const SAVED = {
  api: process.env.INTERNAL_API_TOKEN,
  service: process.env.INTERNAL_SERVICE_TOKEN,
};

beforeEach(() => {
  dataQuery.mockReset();
  mockClient.query.mockClear();
  mockClient.release = vi.fn();
  mockPool.connect.mockClear();
  delete process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
});

afterEach(() => {
  if (SAVED.api === undefined) delete process.env.INTERNAL_API_TOKEN;
  else process.env.INTERNAL_API_TOKEN = SAVED.api;
  if (SAVED.service === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
  else process.env.INTERNAL_SERVICE_TOKEN = SAVED.service;
});

describe('POST /api/internal/royalties/accrue', () => {
  it('REGRESE: projde s heslem z INTERNAL_SERVICE_TOKEN', async () => {
    // Dřív endpoint porovnával jen s INTERNAL_API_TOKEN a vracel 401.
    dataQuery
      .mockResolvedValueOnce({ rows: [PAID_ORDER] })
      .mockResolvedValueOnce({ rows: [AGREEMENT] })
      .mockResolvedValueOnce({ rows: [] }); // INSERT do knihy podílů

    const res = await POST(makeReq({ orderId: 'order-1' }, TOKEN));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accrued: number; results: { royaltyHalire: number }[] };
    expect(body.accrued).toBe(1);
    // 20 % z 1000 Kč = 200 Kč
    expect(body.results[0].royaltyHalire).toBe(20_000);
  });

  it('zapíše podíl do knihy podílů', async () => {
    dataQuery
      .mockResolvedValueOnce({ rows: [PAID_ORDER] })
      .mockResolvedValueOnce({ rows: [AGREEMENT] })
      .mockResolvedValueOnce({ rows: [] });

    await POST(makeReq({ orderId: 'order-1' }, TOKEN));

    const insert = dataQuery.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO lineups.royalty_ledger'),
    );
    expect(insert).toBeDefined();
    expect(insert?.[1]).toEqual(['agr-1', 'order-1', 100_000, 2, 20_000]);
    // Idempotence: druhý pokus o tutéž objednávku nesmí zdvojit podíl.
    expect(String(insert?.[0])).toContain('ON CONFLICT');
  });

  it('bez hesla v prostředí odmítne i správnou hlavičku', async () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    const res = await POST(makeReq({ orderId: 'order-1' }, TOKEN));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe('not_configured');
  });

  it('odmítne špatné heslo a řekne důvod', async () => {
    const res = await POST(makeReq({ orderId: 'order-1' }, 'spatne'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe('mismatch');
  });

  it('odmítne chybějící hlavičku', async () => {
    const res = await POST(makeReq({ orderId: 'order-1' }));
    expect(res.status).toBe(401);
  });

  it('nezaplacenou objednávku přeskočí', async () => {
    dataQuery.mockResolvedValueOnce({ rows: [{ ...PAID_ORDER, status: 'pending' }] });
    const res = await POST(makeReq({ orderId: 'order-1' }, TOKEN));
    const body = (await res.json()) as { skipped?: string };
    expect(body.skipped).toBeDefined();
  });

  it('bez smlouvy o podílu nic nezapíše', async () => {
    dataQuery
      .mockResolvedValueOnce({ rows: [PAID_ORDER] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await POST(makeReq({ orderId: 'order-1' }, TOKEN));
    const body = (await res.json()) as { accrued: number };
    expect(body.accrued).toBe(0);
    const insert = dataQuery.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO lineups.royalty_ledger'),
    );
    expect(insert).toBeUndefined();
  });

  it('neznámá objednávka vrátí 404', async () => {
    dataQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(makeReq({ orderId: 'neexistuje' }, TOKEN));
    expect(res.status).toBe(404);
  });

  it('chybějící orderId vrátí 400', async () => {
    const res = await POST(makeReq({}, TOKEN));
    expect(res.status).toBe(400);
  });
});
