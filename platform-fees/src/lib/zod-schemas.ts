import { z } from 'zod';

export const CreateFeeScheduleSchema = z.object({
  promoterId: z.string().uuid('promoterId musí být UUID'),
  name: z.string().min(1).max(100).optional().default('default'),
  percentageFee: z
    .number()
    .int('percentageFee musí být celé číslo')
    .min(0, 'percentageFee nesmí být záporné')
    .max(10000, 'percentageFee nesmí přesáhnout 10000 (= 100%)'),
  fixedFee: z
    .number()
    .int('fixedFee musí být celé číslo')
    .min(0, 'fixedFee nesmí být záporné'),
  minFee: z
    .number()
    .int('minFee musí být celé číslo')
    .min(0, 'minFee nesmí být záporné')
    .nullable()
    .optional()
    .default(null),
  maxFee: z
    .number()
    .int('maxFee musí být celé číslo')
    .min(0, 'maxFee nesmí být záporné')
    .nullable()
    .optional()
    .default(null),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().nullable().optional().default(null),
}).refine(
  (data) => {
    if (data.minFee != null && data.maxFee != null) {
      return data.minFee <= data.maxFee;
    }
    return true;
  },
  { message: 'minFee nesmí být větší než maxFee', path: ['minFee'] },
);

export const UpdateFeeScheduleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  percentageFee: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .optional(),
  fixedFee: z
    .number()
    .int()
    .min(0)
    .optional(),
  minFee: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional(),
  maxFee: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  isActive: z.boolean().optional(),
}).refine(
  (data) => {
    if (data.minFee != null && data.maxFee != null) {
      return data.minFee <= data.maxFee;
    }
    return true;
  },
  { message: 'minFee nesmí být větší než maxFee', path: ['minFee'] },
);

export const CalculateFeeRequestSchema = z.object({
  promoterId: z.string().uuid('promoterId musí být UUID'),
  lineItems: z
    .array(
      z.object({
        price: z
          .number()
          .int('price musí být celé číslo')
          .min(0, 'price nesmí být záporný'),
        quantity: z
          .number()
          .int('quantity musí být celé číslo')
          .min(1, 'quantity musí být alespoň 1'),
      }),
    )
    .min(1, 'lineItems nesmí být prázdné'),
});

export const RevenueSummaryFiltersSchema = z.object({
  from: z.string().datetime({ message: 'from musí být ISO datetime' }),
  to: z.string().datetime({ message: 'to musí být ISO datetime' }),
  promoterId: z.string().uuid().optional(),
});

export type CreateFeeScheduleInput = z.infer<typeof CreateFeeScheduleSchema>;
export type UpdateFeeScheduleInput = z.infer<typeof UpdateFeeScheduleSchema>;
export type CalculateFeeRequest = z.infer<typeof CalculateFeeRequestSchema>;
export type RevenueSummaryFilters = z.infer<typeof RevenueSummaryFiltersSchema>;
