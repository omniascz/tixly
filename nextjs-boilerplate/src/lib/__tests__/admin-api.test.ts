import { describe, it, expect, vi, beforeEach } from 'vitest';
import api from '@/lib/api';
import { adminApi } from '@/lib/admin-api';
import type { AdminOrder, AdminOrdersResponse } from '@/types/admin';

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function makeOrder(overrides: Partial<AdminOrder>): AdminOrder {
  return {
    orderId: 'o-1',
    orderNumber: 'ORD-2026-0001',
    createdAt: '2026-04-01T10:00:00Z',
    buyerName: 'Jan Novák',
    buyerEmail: 'jan@example.com',
    buyerPhone: null,
    eventId: 'e-1',
    eventName: 'Koncert',
    totalHalire: 50000,
    ticketCount: 2,
    ticketSummary: '2× standard',
    status: 'paid',
    paidAt: '2026-04-01T10:01:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockedApi.get.mockReset();
});

describe('adminApi.events', () => {
  it('GETs /api/admin/events and returns array', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [{ id: '1', name: 'A', date: '2026-05-01' }] });
    const result = await adminApi.events();
    expect(mockedApi.get).toHaveBeenCalledWith('/api/admin/events');
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('A');
  });
});

describe('adminApi.orders', () => {
  it('builds query string from filters', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { items: [], total: 0, totalRevenueHalire: 0, page: 1, limit: 20, totalPages: 0 },
    });
    await adminApi.orders({ eventId: 'e-1', status: 'paid', page: 2, limit: 10 });
    expect(mockedApi.get).toHaveBeenCalledWith(
      '/api/admin/orders?eventId=e-1&status=paid&page=2&limit=10',
    );
  });

  it('omits empty filters', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { items: [], total: 0, totalRevenueHalire: 0, page: 1, limit: 20, totalPages: 0 },
    });
    await adminApi.orders({});
    expect(mockedApi.get).toHaveBeenCalledWith('/api/admin/orders');
  });
});

describe('adminApi.ordersExportUrl', () => {
  it('returns URL with filters appended', () => {
    const url = adminApi.ordersExportUrl({ eventId: 'e-1', from: '2026-04-01' });
    expect(url).toBe('/api/admin/orders/export?eventId=e-1&from=2026-04-01');
  });

  it('returns base URL when no filters', () => {
    expect(adminApi.ordersExportUrl()).toBe('/api/admin/orders/export');
  });
});

describe('adminApi.customers', () => {
  it('aggregates orders by buyer email', async () => {
    const response: AdminOrdersResponse = {
      items: [
        makeOrder({ orderId: 'o-1', buyerEmail: 'a@x.cz', totalHalire: 10000, createdAt: '2026-01-01T00:00:00Z' }),
        makeOrder({ orderId: 'o-2', buyerEmail: 'a@x.cz', totalHalire: 20000, createdAt: '2026-02-01T00:00:00Z' }),
        makeOrder({ orderId: 'o-3', buyerEmail: 'b@x.cz', totalHalire: 5000, createdAt: '2026-03-01T00:00:00Z' }),
      ],
      total: 3,
      totalRevenueHalire: 35000,
      page: 1,
      limit: 100,
      totalPages: 1,
    };
    mockedApi.get.mockResolvedValueOnce({ data: response });

    const customers = await adminApi.customers();

    expect(customers).toHaveLength(2);
    const a = customers.find((c) => c.email === 'a@x.cz');
    const b = customers.find((c) => c.email === 'b@x.cz');
    expect(a?.ordersCount).toBe(2);
    expect(a?.totalSpentHalire).toBe(30000);
    expect(a?.lastOrderAt).toBe('2026-02-01T00:00:00Z');
    expect(b?.ordersCount).toBe(1);
    // sorted descending by totalSpent
    expect(customers[0]?.email).toBe('a@x.cz');
  });

  it('paginates until totalPages reached', async () => {
    mockedApi.get
      .mockResolvedValueOnce({
        data: {
          items: [makeOrder({ orderId: 'p1', buyerEmail: 'a@x.cz' })],
          total: 2,
          totalRevenueHalire: 50000,
          page: 1,
          limit: 100,
          totalPages: 2,
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [makeOrder({ orderId: 'p2', buyerEmail: 'b@x.cz' })],
          total: 2,
          totalRevenueHalire: 50000,
          page: 2,
          limit: 100,
          totalPages: 2,
        },
      });

    const customers = await adminApi.customers();
    expect(mockedApi.get).toHaveBeenCalledTimes(2);
    expect(customers).toHaveLength(2);
  });
});
