import { z } from 'zod';

const UPSELL_TYPES = [
  'insurance',
  'vip_upgrade',
  'meet_greet',
  'parking',
  'fnb_voucher',
  'merchandise',
  'camping_pass',
  'locker',
  'travel_package',
  'livestream',
] as const;

const UPSELL_TIMINGS = ['checkout', 'post_purchase', 'pre_event', 'on_site'] as const;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuidSchema = z.string().regex(UUID_REGEX, 'Must be a valid UUID');

const upsellRuleInputSchema = z.object({
  ticketTypeId: uuidSchema.optional(),
  timing: z.enum(UPSELL_TIMINGS),
  sortOrder: z.number().int().min(0).optional().default(100),
  maxPerOrder: z.number().int().min(1).optional(),
  availableFrom: z.string().datetime().optional(),
  availableUntil: z.string().datetime().optional(),
  exclusiveToTicketTypes: z.array(uuidSchema).optional().default([]),
  conditions: z.record(z.unknown()).optional().default({}),
});

export const createUpsellItemSchema = z.object({
  type: z.enum(UPSELL_TYPES),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  price: z.number().int().min(0),
  currency: z.string().length(3).optional().default('CZK'),
  imageUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
  totalQty: z.number().int().min(1).optional(),
  lowThreshold: z.number().int().min(0).optional().default(5),
  rules: z.array(upsellRuleInputSchema).min(1),
});

export const updateUpsellItemSchema = createUpsellItemSchema.partial().extend({
  rules: z.array(upsellRuleInputSchema).optional(),
});

export const addUpsellsToOrderSchema = z.object({
  items: z
    .array(
      z.object({
        upsellItemId: uuidSchema,
        quantity: z.number().int().min(1),
        ticketId: uuidSchema.optional(),
        variantMetadata: z.record(z.unknown()).optional().default({}),
      }),
    )
    .min(1),
  idempotencyKey: uuidSchema,
});

export const getUpsellsQuerySchema = z.object({
  timing: z.enum(UPSELL_TIMINGS),
  ticketTypeId: uuidSchema.optional(),
  userId: uuidSchema.optional(),
});

export const staffUpsellSchema = z.object({
  ticketId: uuidSchema,
  upsellItemId: uuidSchema,
  quantity: z.number().int().min(1),
  staffId: z.string().min(1),
  idempotencyKey: uuidSchema,
  offlineCreatedAt: z.string().datetime().optional(),
});

export type CreateUpsellItemInput = z.infer<typeof createUpsellItemSchema>;
export type UpdateUpsellItemInput = z.infer<typeof updateUpsellItemSchema>;
export type AddUpsellsToOrderInput = z.infer<typeof addUpsellsToOrderSchema>;
export type GetUpsellsQuery = z.infer<typeof getUpsellsQuerySchema>;
export type StaffUpsellInput = z.infer<typeof staffUpsellSchema>;
export type UpsellRuleInput = z.infer<typeof upsellRuleInputSchema>;
