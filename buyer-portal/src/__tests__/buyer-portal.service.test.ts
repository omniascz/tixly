import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listBuyerTickets,
  getBuyerTicketDetail,
  listBuyerOrders,
  getBuyerOrderDetail,
  generateCurrentTotp,
} from '../services/buyer-portal.service.js';
import { BuyerPortalError } from '../lib/buyer-portal-errors.js';
import type { ServiceDeps } from '../lib/service-container.js';

// ---------------------------------------------------------------------------
// Mock @tixly/crypto pro getBuyerTicketDetail
// ---------------------------------------------------------------------------
vi.mock('@tixly/crypto', () => ({
  decryptSecret: vi.fn(async () => Buffer.from('JBSWY3DPEHPK3PXP', 'utf8')),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const USER_A = 'user-aaa-111';
const USER_B = 'user-bbb-222';

function makeTicketRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ticket_id: 'ticket-1',
    order_id: 'order-1',
    status: 'valid',
    barcode_code: 'BC-12345',
    short_code: 'AB12CD',
    holder_name: 'Jan Novák',
    issued_at: new Date('2026-01-01T10:00:00Z'),
    ticket_type_name: 'Standard',
    zone: 'A',
    row_label: '3',
    seat_number: '12',
    totp_secret_encrypted: Buffer.from('encrypted'),
    totp_secret_iv: Buffer.from('iv'),
    event_id: 'event-1',
    event_name: 'Koncert',
    event_date: new Date('2026-06-01T19:00:00Z'),
    venue_name: 'Forum Karlín',
    ...overrides,
  };
}

function makeOrderRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    order_id: 'order-1',
    created_at: new Date('2026-01-01T10:00:00Z'),
    status: 'paid',
    total_amount_halire: 150000,
    subtotal_halire: 140000,
    fees_halire: 10000,
    refunded_amount_halire: null,
    paid_at: new Date('2026-01-01T10:05:00Z'),
    ticket_count: 2,
    event_name: 'Koncert',
    distinct_event_count: 1,
    ...overrides,
  };
}

function makeMockDeps(queryImpl: (sql: string, params?: unknown[]) => Promise<any[]>): ServiceDeps {
  return {
    db: {
      query: vi.fn(queryImpl) as any,
      execute: vi.fn() as any,
      transaction: vi.fn() as any,
    } as any,
  };
}

// ---------------------------------------------------------------------------
// generateCurrentTotp
// ---------------------------------------------------------------------------

describe('generateCurrentTotp', () => {
  it('returns 8-digit string and validUntil within 30s in the future', () => {
    const secret = Buffer.from('JBSWY3DPEHPK3PXP', 'utf8');
    const { code, validUntil } = generateCurrentTotp(secret);

    expect(code).toMatch(/^\d{8}$/);

    const validUntilMs = new Date(validUntil).getTime();
    const nowMs = Date.now();
    expect(validUntilMs).toBeGreaterThan(nowMs);
    expect(validUntilMs - nowMs).toBeLessThanOrEqual(30_000);
  });
});

// ---------------------------------------------------------------------------
// listBuyerTickets
// ---------------------------------------------------------------------------

describe('listBuyerTickets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns tickets only for given userId', async () => {
    const deps = makeMockDeps(async (sql, params) => {
      // Ověřujeme, že user_id je první parametr
      expect(params?.[0]).toBe(USER_A);
      if (sql.includes('COUNT(*)')) return [{ count: 1 }];
      return [makeTicketRow()];
    });

    const result = await listBuyerTickets(USER_A, {}, {}, deps);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.ticketId).toBe('ticket-1');
    expect(result.items[0]!.seatInfo).toBe('Sekce A / Řada 3 / Místo 12');
    expect(result.total).toBe(1);
  });

  it('filters by status', async () => {
    const queryFn = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('COUNT(*)')) return [{ count: 0 }];
      return [];
    });
    const deps: ServiceDeps = {
      db: { query: queryFn, execute: vi.fn(), transaction: vi.fn() } as any,
    };

    await listBuyerTickets(USER_A, { status: 'used' }, {}, deps);

    const listCall = queryFn.mock.calls.find((c) => !String(c[0]).includes('COUNT(*)'));
    expect(listCall).toBeDefined();
    expect(String(listCall![0])).toContain('t.status = $2');
    expect(listCall![1]).toEqual([USER_A, 'used', 20, 0]);
  });

  it('respects pagination', async () => {
    const queryFn = vi.fn(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return [{ count: 100 }];
      return [];
    });
    const deps: ServiceDeps = {
      db: { query: queryFn, execute: vi.fn(), transaction: vi.fn() } as any,
    };

    await listBuyerTickets(USER_A, {}, { limit: 5, offset: 10 }, deps);

    const listCall = queryFn.mock.calls.find((c) => !String(c[0]).includes('COUNT(*)'));
    expect(listCall![1]).toEqual([USER_A, 5, 10]);
  });
});

// ---------------------------------------------------------------------------
// getBuyerTicketDetail
// ---------------------------------------------------------------------------

describe('getBuyerTicketDetail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns detail with TOTP code and pdfDownloadUrl', async () => {
    const deps = makeMockDeps(async () => [makeTicketRow()]);

    const detail = await getBuyerTicketDetail('ticket-1', USER_A, deps);

    expect(detail.ticketId).toBe('ticket-1');
    expect(detail.totpCode).toMatch(/^\d{8}$/);
    expect(detail.totpValidUntil).toBeTruthy();
    expect(detail.pdfDownloadUrl).toBe('/api/portal/me/tickets/ticket-1/pdf');
    expect(detail.barcodeCode).toBe('BC-12345');
    expect(detail.shortCode).toBe('AB12CD');
  });

  it('throws TICKET_NOT_FOUND when ticket belongs to different user', async () => {
    // DB filtruje podle user_id → nevrátí žádný řádek
    const deps = makeMockDeps(async (_sql, params) => {
      expect(params?.[0]).toBe(USER_B);
      return [];
    });

    await expect(getBuyerTicketDetail('ticket-1', USER_B, deps)).rejects.toMatchObject({
      code: 'TICKET_NOT_FOUND',
    });
    await expect(getBuyerTicketDetail('ticket-1', USER_B, deps)).rejects.toBeInstanceOf(
      BuyerPortalError,
    );
  });
});

// ---------------------------------------------------------------------------
// listBuyerOrders
// ---------------------------------------------------------------------------

describe('listBuyerOrders', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only orders for given userId', async () => {
    const deps = makeMockDeps(async (sql, params) => {
      expect(params?.[0]).toBe(USER_A);
      if (sql.includes('COUNT(*)')) return [{ count: 1 }];
      return [makeOrderRow()];
    });

    const result = await listBuyerOrders(USER_A, {}, deps);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.orderId).toBe('order-1');
    expect(result.items[0]!.totalAmountHalire).toBe(150000);
    expect(result.items[0]!.eventName).toBe('Koncert');
    expect(result.total).toBe(1);
  });

  it('returns "multiple" eventName when order spans multiple events', async () => {
    const deps = makeMockDeps(async (sql) => {
      if (sql.includes('COUNT(*)')) return [{ count: 1 }];
      return [makeOrderRow({ distinct_event_count: 3 })];
    });

    const { items } = await listBuyerOrders(USER_A, {}, deps);
    expect(items[0]!.eventName).toBe('multiple');
  });
});

// ---------------------------------------------------------------------------
// getBuyerOrderDetail
// ---------------------------------------------------------------------------

describe('getBuyerOrderDetail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns order detail with tickets', async () => {
    const deps = makeMockDeps(async (sql) => {
      if (sql.includes('FROM orders.orders o')) return [makeOrderRow()];
      if (sql.includes('FROM tickets.tickets t')) return [makeTicketRow()];
      return [];
    });

    const detail = await getBuyerOrderDetail('order-1', USER_A, deps);
    expect(detail.orderId).toBe('order-1');
    expect(detail.tickets).toHaveLength(1);
    expect(detail.subtotalHalire).toBe(140000);
    expect(detail.feesHalire).toBe(10000);
  });

  it('throws ORDER_NOT_FOUND when order belongs to different user', async () => {
    const deps = makeMockDeps(async () => []);

    await expect(getBuyerOrderDetail('order-1', USER_B, deps)).rejects.toMatchObject({
      code: 'ORDER_NOT_FOUND',
    });
  });
});
