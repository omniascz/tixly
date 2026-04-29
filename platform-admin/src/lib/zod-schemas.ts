import { z } from 'zod';

// Dashboard
export const DailyStatsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

// Promoter filters
export const PromoterFiltersSchema = z.object({
  status: z.string().optional(),
  kycStatus: z.string().optional(),
  search: z.string().optional(),
  createdFrom: z.string().datetime({ offset: true }).optional(),
  createdTo: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  sortBy: z
    .enum(['created_at', 'name', 'total_revenue', 'last_activity'])
    .default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Bulk action
export const BulkActionBodySchema = z.object({
  promoterIds: z.array(z.string().uuid()).min(1),
  action: z.enum(['suspend', 'activate', 'ban']),
  reason: z.string().min(1).max(500),
});

// KYC queue
export const KycQueueQuerySchema = z.object({
  priority: z.enum(['all', 'waiting_long']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// Notifications list
export const NotificationsQuerySchema = z.object({
  isRead: z
    .string()
    .optional()
    .transform((v) => {
      if (v === 'true') return true;
      if (v === 'false') return false;
      return undefined;
    }),
  priority: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Audit log
export const AuditLogQuerySchema = z.object({
  adminUserId: z.string().uuid().optional(),
  targetType: z.string().optional(),
  targetId: z.string().uuid().optional(),
  action: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
