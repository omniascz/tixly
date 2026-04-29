import api from './api';
import type {
  AdminEvent,
  AdminOrdersResponse,
  AdminOrderFilters,
  AdminCustomer,
  AdminPayout,
} from '@/types/admin';

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
    const all: AdminCustomer[] = [];
    let page = 1;
    const seen = new Map<string, AdminCustomer>();
    while (page <= 5) {
      const res = await adminApi.orders({ status: 'paid', page, limit: 100 });
      for (const o of res.items) {
        const existing = seen.get(o.buyerEmail);
        if (existing) {
          existing.ordersCount += 1;
          existing.totalSpentHalire += o.totalHalire;
          if (o.createdAt > existing.lastOrderAt) {
            existing.lastOrderAt = o.createdAt;
          }
        } else {
          seen.set(o.buyerEmail, {
            email: o.buyerEmail,
            name: o.buyerName,
            phone: o.buyerPhone,
            ordersCount: 1,
            totalSpentHalire: o.totalHalire,
            lastOrderAt: o.createdAt,
          });
        }
      }
      if (page >= res.totalPages) break;
      page += 1;
    }
    for (const c of seen.values()) all.push(c);
    all.sort((a, b) => b.totalSpentHalire - a.totalSpentHalire);
    return all;
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
