'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin-api';
import type { AdminOrderFilters } from '@/types/admin';

export function useAdminEvents() {
  return useQuery({
    queryKey: ['admin', 'events'],
    queryFn: () => adminApi.events(),
  });
}

export function useAdminOrders(filters: AdminOrderFilters = {}) {
  return useQuery({
    queryKey: ['admin', 'orders', filters],
    queryFn: () => adminApi.orders(filters),
    placeholderData: (prev) => prev,
  });
}

export function useAdminCustomers() {
  return useQuery({
    queryKey: ['admin', 'customers'],
    queryFn: () => adminApi.customers(),
    staleTime: 1000 * 60 * 10,
  });
}

export function useAdminPayouts() {
  return useQuery({
    queryKey: ['admin', 'payouts'],
    queryFn: () => adminApi.payouts(),
  });
}
