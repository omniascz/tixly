import { z } from 'zod';

export const CreatePromoterSchema = z.object({
  name: z.string().min(1).max(200),
  legalName: z.string().max(200).optional(),
  ico: z.string().max(20).optional(),
  dic: z.string().max(20).optional(),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
  website: z.string().url().optional(),
  defaultCurrency: z.string().length(3).optional(),
  timezone: z.string().max(50).optional(),
});

export const UpdatePromoterSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  legalName: z.string().max(200).nullable().optional(),
  ico: z.string().max(20).nullable().optional(),
  dic: z.string().max(20).nullable().optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).nullable().optional(),
  website: z.string().url().nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  brandColors: z
    .object({
      primary: z.string().optional(),
      secondary: z.string().optional(),
      accent: z.string().optional(),
    })
    .optional(),
  slug: z.string().max(100).regex(/^[a-z0-9-]+$/).optional(),
  defaultCurrency: z.string().length(3).optional(),
  timezone: z.string().max(50).optional(),
});

export const BankAccountSchema = z.object({
  iban: z.string().min(5).max(34),
  swift: z.string().min(8).max(11).optional(),
});

export const AddMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'manager', 'finance', 'marketing', 'staff', 'gate']),
});

export const UpdateMemberRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'manager', 'finance', 'marketing', 'staff', 'gate']),
});

export const RejectKycSchema = z.object({
  notes: z.string().min(1),
});

export const SuspendSchema = z.object({
  reason: z.string().min(1),
});

export const BanSchema = z.object({
  reason: z.string().min(1),
});

export const CreateFeeScheduleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  percentageFee: z.number().int().min(0).max(10000),
  fixedFee: z.number().int().min(0),
  minFee: z.number().int().min(0).nullable().optional(),
  maxFee: z.number().int().min(0).nullable().optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().nullable().optional(),
});

export const PromoterFiltersSchema = z.object({
  status: z.enum(['pending', 'active', 'suspended', 'banned', 'closed']).optional(),
  kyc_status: z.enum(['not_started', 'submitted', 'verified', 'rejected']).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreatePromoterInput = z.infer<typeof CreatePromoterSchema>;
export type UpdatePromoterInput = z.infer<typeof UpdatePromoterSchema>;
export type BankAccountInput = z.infer<typeof BankAccountSchema>;
export type CreateFeeScheduleInput = z.infer<typeof CreateFeeScheduleSchema>;
export type PromoterFilters = z.infer<typeof PromoterFiltersSchema>;
