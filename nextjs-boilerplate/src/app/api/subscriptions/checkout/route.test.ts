/**
 * Unit testy pro POST /api/subscriptions/checkout.
 *
 * Mockujeme pg.Pool — testujeme jen request/response handling, ne SQL.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// dataQuery = jen DATA dotazy (SELECT/INSERT/...). Control statements (SET app.role
// injektovaný rls-pool kontextem, BEGIN/COMMIT/ROLLBACK) jsou transparentní —
// nekonzumují sekvenci mockResolvedValueOnce. Tím je mock nezávislý na tom, kolik
// SET LOCAL rls-pool přidá.
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
const mockPool = {
  connect: vi.fn(async () => mockClient),
};

vi.mock('pg', () => ({
  Pool: vi.fn(() => mockPool),
}));

import { POST } from './route';

function makeReq(body: unknown, headers: Record<string, string> = {}): import('next/server').NextRequest {
  return {
    json: async () => body,
    headers: {
      get: (k: string) => headers[k.toLowerCase()] ?? null,
    },
  } as unknown as import('next/server').NextRequest;
}

const VALID_BODY = {
  packageId: '11111111-1111-1111-1111-111111111111',
  buyerEmail: 'buyer@example.com',
  buyerName: 'Jan Novák',
};

beforeEach(() => {
  dataQuery.mockReset();
  mockClient.query.mockClear();
  // rls-pool connect() přepíše client.release vlastním RESET wrapperem → reassign na čistý vi.fn
  mockClient.release = vi.fn();
  mockPool.connect.mockClear();
});

describe('POST /api/subscriptions/checkout', () => {
  it('422 při chybějícím packageId', async () => {
    const res = await POST(makeReq({ buyerEmail: 'a@b.cz', buyerName: 'X' }));
    expect(res.status).toBe(422);
  });

  it('404 pokud package neexistuje', async () => {
    dataQuery.mockResolvedValueOnce({ rows: [] }); // SELECT package
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('PACKAGE_NOT_FOUND');
  });

  it('409 pokud package není on_sale', async () => {
    dataQuery.mockResolvedValueOnce({
      rows: [
        {
          id: VALID_BODY.packageId,
          promoter_id: 'p1',
          status: 'draft',
          sale_start: new Date().toISOString(),
          sale_end: null,
          capacity: null,
          base_price_halire: 250000,
          early_bird_until: null,
          early_bird_price_halire: null,
          currency: 'CZK',
        },
      ],
    });
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('NOT_ON_SALE');
  });

  it('409 pokud SOLD_OUT (capacity exhausted)', async () => {
    dataQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: VALID_BODY.packageId,
            promoter_id: 'p1',
            status: 'on_sale',
            sale_start: new Date(Date.now() - 86400000).toISOString(),
            sale_end: null,
            capacity: 10,
            base_price_halire: 250000,
            early_bird_until: null,
            early_bird_price_halire: null,
            currency: 'CZK',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ count: '10' }] }); // sold count
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('SOLD_OUT');
  });

  it('200 happy path, vrátí holderId + gatewayUrl + price', async () => {
    dataQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: VALID_BODY.packageId,
            promoter_id: 'p1',
            status: 'on_sale',
            sale_start: new Date(Date.now() - 86400000).toISOString(),
            sale_end: null,
            capacity: 100,
            base_price_halire: 250000,
            early_bird_until: null,
            early_bird_price_halire: null,
            currency: 'CZK',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ count: '5' }] }) // sold count (under capacity)
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] }) // guest user upsert
      .mockResolvedValueOnce({ rows: [{ id: 'holder-1' }] }); // holder insert

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.holderId).toBe('holder-1');
    expect(json.pricePaidHalire).toBe(250000);
    expect(json.currency).toBe('CZK');
    expect(json.gatewayUrl).toMatch(/^\/mock-subscription\/.+/);
  });

  it('early-bird cena aplikovaná pokud early_bird_until v budoucnosti', async () => {
    const future = new Date(Date.now() + 7 * 86400000).toISOString();
    dataQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: VALID_BODY.packageId,
            promoter_id: 'p1',
            status: 'on_sale',
            sale_start: new Date(Date.now() - 86400000).toISOString(),
            sale_end: null,
            capacity: null,
            base_price_halire: 250000,
            early_bird_until: future,
            early_bird_price_halire: 200000,
            currency: 'CZK',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'holder-1' }] });

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pricePaidHalire).toBe(200000);
  });

  it('409 SEAT_TAKEN při konfliktu uq constraint', async () => {
    dataQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: VALID_BODY.packageId,
            promoter_id: 'p1',
            status: 'on_sale',
            sale_start: new Date(Date.now() - 86400000).toISOString(),
            sale_end: null,
            capacity: null,
            base_price_halire: 250000,
            early_bird_until: null,
            early_bird_price_halire: null,
            currency: 'CZK',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
      .mockRejectedValueOnce(new Error('duplicate key uq_subs_holders_seat'));

    const res = await POST(
      makeReq({
        ...VALID_BODY,
        preferredSeatId: '22222222-2222-2222-2222-222222222222',
      }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('SEAT_TAKEN');
  });
});
