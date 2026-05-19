import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminApi } from '@/lib/admin-api';
import api from '@/lib/api';

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn> };

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
  // Server-side agregace přes /api/admin/customers nahradila client-side reduce z orders pages.
  // Endpoint vrací { customers: Array<{ email, name, phone, ordersCount, totalSpentHalire, lastOrderAt }> }.

  it('mapuje server response na AdminCustomer[]', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        customers: [
          {
            email: 'a@x.cz',
            name: 'Alice',
            phone: '+420111111111',
            ordersCount: 2,
            totalSpentHalire: 30000,
            lastOrderAt: '2026-02-01T00:00:00Z',
          },
          {
            email: 'b@x.cz',
            name: null,
            phone: null,
            ordersCount: 1,
            totalSpentHalire: 5000,
            lastOrderAt: '2026-03-01T00:00:00Z',
          },
        ],
      },
    });

    const customers = await adminApi.customers();

    expect(mockedApi.get).toHaveBeenCalledWith('/api/admin/customers?limit=500');
    expect(customers).toHaveLength(2);
    const a = customers.find((c) => c.email === 'a@x.cz');
    expect(a?.ordersCount).toBe(2);
    expect(a?.totalSpentHalire).toBe(30000);
    expect(a?.lastOrderAt).toBe('2026-02-01T00:00:00Z');
    // null name fallback na email
    const b = customers.find((c) => c.email === 'b@x.cz');
    expect(b?.name).toBe('b@x.cz');
  });

  it('vrátí prázdné pole když server nevrátí žádné zákazníky', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { customers: [] } });
    const customers = await adminApi.customers();
    expect(customers).toEqual([]);
  });
});
