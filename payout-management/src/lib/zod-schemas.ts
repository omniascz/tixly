import { z } from 'zod';

export const PayoutCycleSchema = z.enum(['daily', 'weekly', 'monthly', 'post_event', 'manual']);
export const PayoutStatusSchema = z.enum(['pending', 'approved', 'processing', 'paid', 'failed']);

export const UpdatePayoutSettingsSchema = z.object({
  payoutCycle: PayoutCycleSchema.optional(),
  rollingReservePct: z
    .number()
    .int()
    .min(0)
    .max(5000)
    .optional(),
  reserveReleaseDays: z.number().int().min(1).max(365).optional(),
  minPayoutAmount: z.number().int().min(0).optional(),
});

export const MarkPayoutPaidSchema = z.object({
  bankReference: z.string().min(1).max(100),
});

export const MarkPayoutFailedSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const AdminListPayoutsQuerySchema = z.object({
  promoterId: z.string().uuid().optional(),
  status: PayoutStatusSchema.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ListPayoutsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const UpdatePayoutSettingsBodySchema = z.object({
  payoutCycle: PayoutCycleSchema.optional(),
  rollingReservePct: z.number().int().min(0).max(5000).optional(),
  reserveReleaseDays: z.number().int().min(1).max(365).optional(),
  minPayoutAmount: z.number().int().min(0).optional(),
});
