import { z } from 'zod';

// ------------------------------------------------------------------ //
// Shared primitives
// ------------------------------------------------------------------ //

const uuidSchema = z.string().uuid();

// Procento v haléřích: 0–10000 (10000 = 100 %)
const percentageSchema = z.number().int().min(0).max(10000);

const refundPolicyTypeSchema = z.enum([
  'no_refund',
  'full_refund',
  'partial_refund',
  'tiered_refund',
  'credit_only',
]);

const refundMethodSchema = z.enum([
  'original_payment',
  'platform_credit',
  'both_allowed',
]);

// ------------------------------------------------------------------ //
// Policy tiers
// ------------------------------------------------------------------ //

export const refundPolicyTierInputSchema = z.object({
  minDaysBefore: z.number().int().min(0),
  refundPct: percentageSchema,
  label: z.string().max(100).nullable().optional(),
  sortOrder: z.number().int().optional().default(0),
});

export type RefundPolicyTierInput = z.infer<typeof refundPolicyTierInputSchema>;

// ------------------------------------------------------------------ //
// Create policy
// ------------------------------------------------------------------ //

export const createPolicySchema = z
  .object({
    name: z.string().min(1).max(100).optional().default('Výchozí politika'),
    policyType: refundPolicyTypeSchema,
    refundPercentage: percentageSchema.nullable().optional(),
    refundMethod: refundMethodSchema.optional().default('original_payment'),
    allowSelfService: z.boolean().optional().default(false),
    minDaysBeforeEvent: z.number().int().min(0).nullable().optional(),
    maxDaysAfterPurchase: z.number().int().min(0).nullable().optional(),
    isDefault: z.boolean().optional().default(true),
    tiers: z.array(refundPolicyTierInputSchema).optional().default([]),
  })
  .superRefine((data, ctx) => {
    if (data.policyType === 'partial_refund') {
      if (data.refundPercentage == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'refundPercentage je povinné pro partial_refund',
          path: ['refundPercentage'],
        });
      }
    }
    if (data.policyType === 'tiered_refund') {
      if (!data.tiers || data.tiers.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'tiers jsou povinné pro tiered_refund (min 1 tier)',
          path: ['tiers'],
        });
      }
    }
  });

export type CreatePolicyInput = z.infer<typeof createPolicySchema>;

// ------------------------------------------------------------------ //
// Update policy — všechna pole volitelná, stejné superRefine
// ------------------------------------------------------------------ //

export const updatePolicySchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    policyType: refundPolicyTypeSchema.optional(),
    refundPercentage: percentageSchema.nullable().optional(),
    refundMethod: refundMethodSchema.optional(),
    allowSelfService: z.boolean().optional(),
    minDaysBeforeEvent: z.number().int().min(0).nullable().optional(),
    maxDaysAfterPurchase: z.number().int().min(0).nullable().optional(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
    tiers: z.array(refundPolicyTierInputSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.policyType === 'partial_refund' && data.refundPercentage == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'refundPercentage je povinné pro partial_refund',
        path: ['refundPercentage'],
      });
    }
    if (data.policyType === 'tiered_refund') {
      if (!data.tiers || data.tiers.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'tiers jsou povinné pro tiered_refund (min 1 tier)',
          path: ['tiers'],
        });
      }
    }
  });

export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;

// ------------------------------------------------------------------ //
// Event override
// ------------------------------------------------------------------ //

export const eventOverrideSchema = z.object({
  policyId: uuidSchema,
});

// ------------------------------------------------------------------ //
// Refund request
// ------------------------------------------------------------------ //

export const createRefundRequestSchema = z.object({
  reason: z.string().min(1).max(2000),
  ticketId: uuidSchema.optional(),
  requestedAmount: z.number().int().min(1).optional(),
  idempotencyKey: uuidSchema,
});

export const selfServiceRefundSchema = z.object({
  ticketId: uuidSchema.optional(),
  idempotencyKey: uuidSchema,
});

// ------------------------------------------------------------------ //
// Decide request
// ------------------------------------------------------------------ //

export const decideRefundRequestSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  notes: z.string().max(2000).optional(),
  overrideAmount: z.number().int().min(1).optional(),
});

export type DecideRefundRequestInput = z.infer<typeof decideRefundRequestSchema>;

// ------------------------------------------------------------------ //
// List filters
// ------------------------------------------------------------------ //

export const listRequestsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'processed']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
