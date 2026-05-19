import type {
  AdminEvent,
  AdminOrdersResponse,
  AdminOrderFilters,
  AdminCustomer,
  AdminPayout,
} from '@/types/admin';
import api from './api';

function buildOrderQuery(filters: AdminOrderFilters): string {
  const params = new URLSearchParams();
  if (filters.eventId) params.set('eventId', filters.eventId);
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const adminApi = {
  events: async (): Promise<AdminEvent[]> => {
    const res = await api.get<AdminEvent[]>('/api/admin/events');
    return res.data;
  },

  orders: async (filters: AdminOrderFilters = {}): Promise<AdminOrdersResponse> => {
    const qs = buildOrderQuery(filters);
    const res = await api.get<AdminOrdersResponse>(`/api/admin/orders${qs}`);
    return res.data;
  },

  ordersExportUrl: (filters: AdminOrderFilters = {}): string => {
    const qs = buildOrderQuery(filters);
    return `/api/admin/orders/export${qs}`;
  },

  customers: async (): Promise<AdminCustomer[]> => {
    // Server-side agregace přes /api/admin/customers — nahradilo původní
    // klient-side reduce z 5 stránek orders (limit 500), které nestačily
    // pro promotéry s >500 zákazníky.
    const res = await api.get<{
      customers: Array<{
        email: string;
        name: string | null;
        phone: string | null;
        ordersCount: number;
        totalSpentHalire: number;
        lastOrderAt: string;
      }>;
    }>(`/api/admin/customers?limit=500`);
    return res.data.customers.map((c) => ({
      email: c.email,
      name: c.name ?? c.email,
      phone: c.phone,
      ordersCount: c.ordersCount,
      totalSpentHalire: c.totalSpentHalire,
      lastOrderAt: c.lastOrderAt,
    }));
  },

  payouts: async (): Promise<AdminPayout[]> => {
    const res = await api.get<{
      source: string;
      feePercent?: number;
      payouts: Array<{
        id: string;
        periodStart: string;
        periodEnd: string;
        grossHalire: number;
        feesHalire: number;
        refundsHalire?: number;
        netHalire: number;
        status: string;
        paidAt: string | null;
      }>;
    }>('/api/admin/payouts');
    return res.data.payouts.map((p) => ({
      id: p.id,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      grossHalire: p.grossHalire,
      feesHalire: p.feesHalire,
      netHalire: p.netHalire,
      status: p.status as AdminPayout['status'],
      paidAt: p.paidAt,
    }));
  },

  refundOrder: async (
    orderId: string,
    body: { reason: string; note?: string },
  ): Promise<{
    ok: boolean;
    refundedAmountHalire?: number;
    revokedTickets?: number;
    alreadyRefunded?: boolean;
  }> => {
    const res = await api.post(`/api/admin/orders/${orderId}/refund`, body);
    return res.data as {
      ok: boolean;
      refundedAmountHalire?: number;
      revokedTickets?: number;
      alreadyRefunded?: boolean;
    };
  },

  bulkRefund: async (body: {
    orderIds: string[];
    reason: string;
  }): Promise<{
    processed: number;
    refundedCount: number;
    alreadyRefundedCount: number;
    errorCount: number;
    totalRefundedHalire: number;
  }> => {
    const res = await api.post('/api/admin/orders/bulk-refund', body);
    return res.data as {
      processed: number;
      refundedCount: number;
      alreadyRefundedCount: number;
      errorCount: number;
      totalRefundedHalire: number;
    };
  },
};
