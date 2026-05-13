import { z } from 'zod';

// ─── Shared primitives ───────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

const halereSchema = z
  .number()
  .int('Amount must be an integer (haléře)')
  .nonnegative('Amount must be >= 0');

const fulfillmentSchema = z.enum(['pickup_at_venue', 'shipping', 'digital']);

// ─── Shipping address ────────────────────────────────────────────────────────

export const shippingAddressSchema = z.object({
  name: z.string().min(1).max(200),
  street: z.string().min(1).max(300),
  city: z.string().min(1).max(100),
  postalCode: z.string().min(1).max(20),
  country: z.string().length(2).default('CZ'),
  phone: z.string().max(30).optional(),
});

// ─── Buyer: reserve merchandise ──────────────────────────────────────────────

export const reserveItemSchema = z.object({
  variantId: uuidSchema,
  quantity: z
    .number()
    .int()
    .min(1, 'Minimum quantity is 1')
    .max(10, 'Maximum quantity is 10'),
  shippingAddress: shippingAddressSchema.optional(),
});

export const reserveMerchandiseBodySchema = z.object({
  items: z.array(reserveItemSchema).min(1, 'At least one item required'),
  idempotencyKey: uuidSchema,
});

// ─── Organizer: create product variant ───────────────────────────────────────

export const createVariantSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  priceModifier: halereSchema.default(0),
  totalQty: z.number().int().positive().optional(),
  lowThreshold: z.number().int().nonnegative().default(3),
  attributes: z.record(z.string(), z.string()).default({}),
});

export const updateVariantSchema = createVariantSchema.extend({
  id: uuidSchema.optional(), // present = existing variant, absent = new
});

// ─── Organizer: create product ───────────────────────────────────────────────

export const createProductBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  basePrice: halereSchema,
  currency: z.string().length(3).default('CZK'),
  fulfillment: fulfillmentSchema,
  imageUrls: z.array(z.string().url()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  variants: z.array(createVariantSchema).min(1, 'At least one variant required'),
});

// ─── Organizer: update product ───────────────────────────────────────────────

export const updateProductBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  basePrice: halereSchema.optional(),
  imageUrls: z.array(z.string().url()).optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  variants: z.array(updateVariantSchema).optional(),
});

// ─── Query params ─────────────────────────────────────────────────────────────

export const eventMerchandiseQuerySchema = z.object({
  fulfillment: fulfillmentSchema.optional(),
});

// ─── Inferred types ──────────────────────────────────────────────────────────

export type ReserveMerchandiseBody = z.infer<typeof reserveMerchandiseBodySchema>;
export type CreateProductBody = z.infer<typeof createProductBodySchema>;
export type UpdateProductBody = z.infer<typeof updateProductBodySchema>;
export type ShippingAddressInput = z.infer<typeof shippingAddressSchema>;
export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
