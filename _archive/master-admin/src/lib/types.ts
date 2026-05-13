export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export interface Tenant {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'suspended' | 'pending_verification';
  platformFeePercent: number;  // e.g. 3.5
  createdAt: string;
  totalRevenue?: number;       // haléře
  totalOrders?: number;
}

export interface TenantFilter {
  status?: 'active' | 'suspended' | 'pending_verification';
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ImpersonationToken {
  token: string;
  adminId: string;
  targetPromoterId: string;
  expiresAt: string;
  createdAt: string;
}

export interface AdminAuditEntry {
  id: string;
  adminId: string;
  action: string;
  targetType: 'tenant' | 'platform_fee' | 'impersonation' | 'config';
  targetId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
}

export interface PlatformOverview {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  totalRevenue30d: number;
  totalOrders30d: number;
  totalTickets30d: number;
  topTenantsByRevenue: Array<{ tenantId: string; name: string; revenue: number }>;
  revenueByDay: Array<{ date: string; revenue: number; orders: number }>;
}
