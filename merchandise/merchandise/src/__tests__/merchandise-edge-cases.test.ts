import { describe, it, expect } from 'vitest';
import { MerchandiseError, isMerchandiseError } from '../lib/merchandise-errors';
import type { MerchandiseErrorCode } from '../lib/merchandise-errors';
import type { FulfillmentType, ProductStatus, OrderItemStatus } from '../types/merchandise';
import {
  reserveItemSchema,
  reserveMerchandiseBodySchema,
  createVariantSchema,
  updateVariantSchema,
  createProductBodySchema,
  updateProductBodySchema,
  eventMerchandiseQuerySchema,
  shippingAddressSchema,
} from '../lib/zod-schemas';

// ─── Helpers ────────────────────────────────────────────────────────────────

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const ANOTHER_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// ─── 1. MerchandiseError codes & HTTP status mapping ────────────────────────

describe('MerchandiseError – all error codes', () => {
  const codeStatusPairs: Array<[MerchandiseErrorCode, number]> = [
    ['PRODUCT_NOT_FOUND', 404],
    ['VARIANT_NOT_FOUND', 404],
    ['VARIANT_SOLD_OUT', 409],
    ['INSUFFICIENT_STOCK', 409],
    ['ORDER_NOT_FOUND', 404],
    ['ORDER_ITEM_NOT_FOUND', 404],
    ['DUPLICATE_ORDER', 409],
    ['UNAUTHORIZED', 404],
    ['SHIPPING_REQUIRED', 422],
    ['CANCEL_NOT_ALLOWED', 422],
    ['INVALID_QUANTITY', 422],
  ];

  it.each(codeStatusPairs)('code %s maps to HTTP %i', (code, expectedStatus) => {
    const err = new MerchandiseError(code);
    expect(err.code).toBe(code);
    expect(err.statusCode).toBe(expectedStatus);
    expect(err.name).toBe('MerchandiseError');
  });

  it('UNAUTHORIZED maps to 404 (anti-enumeration), NOT 403', () => {
    const err = new MerchandiseError('UNAUTHORIZED');
    expect(err.statusCode).not.toBe(403);
    expect(err.statusCode).toBe(404);
  });

  it('INSUFFICIENT_STOCK maps to 409, not 422', () => {
    const err = new MerchandiseError('INSUFFICIENT_STOCK');
    expect(err.statusCode).toBe(409);
  });
});

// ─── 2. toHttpError() structure ─────────────────────────────────────────────

describe('MerchandiseError.toHttpError()', () => {
  it('returns { statusCode, code, message } with custom message', () => {
    const err = new MerchandiseError('VARIANT_SOLD_OUT', 'All gone');
    expect(err.toHttpError()).toEqual({
      statusCode: 409,
      code: 'VARIANT_SOLD_OUT',
      message: 'All gone',
    });
  });

  it('uses code as default message when none provided', () => {
    const err = new MerchandiseError('ORDER_NOT_FOUND');
    const http = err.toHttpError();
    expect(http.message).toBe('ORDER_NOT_FOUND');
    expect(http.code).toBe('ORDER_NOT_FOUND');
    expect(http.statusCode).toBe(404);
  });

  it('preserves exact custom message in output', () => {
    const msg = 'Only 2 remaining, requested 5';
    const err = new MerchandiseError('INSUFFICIENT_STOCK', msg);
    expect(err.toHttpError().message).toBe(msg);
  });
});

// ─── 3. isMerchandiseError type guard ───────────────────────────────────────

describe('isMerchandiseError()', () => {
  it('returns true for MerchandiseError instance', () => {
    expect(isMerchandiseError(new MerchandiseError('PRODUCT_NOT_FOUND'))).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(isMerchandiseError(new Error('boom'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isMerchandiseError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isMerchandiseError(undefined)).toBe(false);
  });

  it('returns false for string', () => {
    expect(isMerchandiseError('PRODUCT_NOT_FOUND')).toBe(false);
  });

  it('returns false for plain object mimicking shape', () => {
    expect(isMerchandiseError({ code: 'PRODUCT_NOT_FOUND', statusCode: 404 })).toBe(false);
  });
});

// ─── 4. Zod schema validations ──────────────────────────────────────────────

describe('reserveItemSchema', () => {
  it('accepts valid input', () => {
    const result = reserveItemSchema.safeParse({ variantId: VALID_UUID, quantity: 3 });
    expect(result.success).toBe(true);
  });

  it('rejects missing variantId', () => {
    const result = reserveItemSchema.safeParse({ quantity: 1 });
    expect(result.success).toBe(false);
  });

  it('rejects missing quantity', () => {
    const result = reserveItemSchema.safeParse({ variantId: VALID_UUID });
    expect(result.success).toBe(false);
  });

  it('rejects quantity = 0', () => {
    const result = reserveItemSchema.safeParse({ variantId: VALID_UUID, quantity: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative quantity', () => {
    const result = reserveItemSchema.safeParse({ variantId: VALID_UUID, quantity: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects quantity exceeding maximum (>10)', () => {
    const result = reserveItemSchema.safeParse({ variantId: VALID_UUID, quantity: 11 });
    expect(result.success).toBe(false);
  });

  it('accepts quantity at boundary max (10)', () => {
    const result = reserveItemSchema.safeParse({ variantId: VALID_UUID, quantity: 10 });
    expect(result.success).toBe(true);
  });

  it('rejects non-integer quantity', () => {
    const result = reserveItemSchema.safeParse({ variantId: VALID_UUID, quantity: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID variantId', () => {
    const result = reserveItemSchema.safeParse({ variantId: 'not-a-uuid', quantity: 1 });
    expect(result.success).toBe(false);
  });
});

describe('reserveMerchandiseBodySchema', () => {
  const validBody = {
    items: [{ variantId: VALID_UUID, quantity: 2 }],
    idempotencyKey: ANOTHER_UUID,
  };

  it('accepts valid body', () => {
    expect(reserveMerchandiseBodySchema.safeParse(validBody).success).toBe(true);
  });

  it('rejects empty items array', () => {
    const result = reserveMerchandiseBodySchema.safeParse({
      items: [],
      idempotencyKey: ANOTHER_UUID,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing idempotencyKey', () => {
    const result = reserveMerchandiseBodySchema.safeParse({
      items: [{ variantId: VALID_UUID, quantity: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID idempotencyKey', () => {
    const result = reserveMerchandiseBodySchema.safeParse({
      items: [{ variantId: VALID_UUID, quantity: 1 }],
      idempotencyKey: 'abc',
    });
    expect(result.success).toBe(false);
  });
});

describe('createProductBodySchema', () => {
  const validProduct = {
    name: 'T-Shirt',
    basePrice: 50000,
    fulfillment: 'shipping' as const,
    variants: [{ sku: 'TS-M', name: 'Medium' }],
  };

  it('accepts valid product', () => {
    expect(createProductBodySchema.safeParse(validProduct).success).toBe(true);
  });

  it('rejects missing name', () => {
    const { name: _, ...rest } = validProduct;
    expect(createProductBodySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing basePrice', () => {
    const { basePrice: _, ...rest } = validProduct;
    expect(createProductBodySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects invalid fulfillment value', () => {
    const result = createProductBodySchema.safeParse({
      ...validProduct,
      fulfillment: 'carrier_pigeon',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing variants', () => {
    const { variants: _, ...rest } = validProduct;
    expect(createProductBodySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty variants array', () => {
    const result = createProductBodySchema.safeParse({ ...validProduct, variants: [] });
    expect(result.success).toBe(false);
  });

  it('rejects negative basePrice', () => {
    const result = createProductBodySchema.safeParse({ ...validProduct, basePrice: -100 });
    expect(result.success).toBe(false);
  });

  it('defaults currency to CZK', () => {
    const result = createProductBodySchema.parse(validProduct);
    expect(result.currency).toBe('CZK');
  });

  it('defaults imageUrls to empty array', () => {
    const result = createProductBodySchema.parse(validProduct);
    expect(result.imageUrls).toEqual([]);
  });
});

describe('createVariantSchema', () => {
  it('accepts variant with all fields', () => {
    const result = createVariantSchema.safeParse({
      sku: 'TS-L',
      name: 'Large',
      priceModifier: 1000,
      totalQty: 50,
      lowThreshold: 5,
      attributes: { size: 'L', color: 'red' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal variant (sku + name only)', () => {
    const result = createVariantSchema.safeParse({ sku: 'TS-S', name: 'Small' });
    expect(result.success).toBe(true);
  });

  it('defaults priceModifier to 0', () => {
    const result = createVariantSchema.parse({ sku: 'TS-S', name: 'Small' });
    expect(result.priceModifier).toBe(0);
  });

  it('defaults lowThreshold to 3', () => {
    const result = createVariantSchema.parse({ sku: 'TS-S', name: 'Small' });
    expect(result.lowThreshold).toBe(3);
  });

  it('defaults attributes to empty object', () => {
    const result = createVariantSchema.parse({ sku: 'TS-S', name: 'Small' });
    expect(result.attributes).toEqual({});
  });
});

describe('updateProductBodySchema', () => {
  it('accepts empty body (all fields optional)', () => {
    expect(updateProductBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts partial update with name only', () => {
    expect(updateProductBodySchema.safeParse({ name: 'New Name' }).success).toBe(true);
  });

  it('accepts status change', () => {
    expect(updateProductBodySchema.safeParse({ status: 'archived' }).success).toBe(true);
  });

  it('rejects invalid status value', () => {
    expect(updateProductBodySchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });
});

describe('eventMerchandiseQuerySchema', () => {
  it('accepts valid fulfillment filter', () => {
    expect(eventMerchandiseQuerySchema.safeParse({ fulfillment: 'digital' }).success).toBe(true);
  });

  it('accepts empty query (fulfillment optional)', () => {
    expect(eventMerchandiseQuerySchema.safeParse({}).success).toBe(true);
  });

  it('rejects invalid fulfillment filter', () => {
    expect(eventMerchandiseQuerySchema.safeParse({ fulfillment: 'mail' }).success).toBe(false);
  });
});

// ─── 5. Shipping address schema ─────────────────────────────────────────────

describe('shippingAddressSchema', () => {
  const validAddress = {
    name: 'Jan Novak',
    street: 'Vodickova 12',
    city: 'Praha',
    postalCode: '11000',
    country: 'CZ',
  };

  it('accepts valid address', () => {
    expect(shippingAddressSchema.safeParse(validAddress).success).toBe(true);
  });

  it('accepts address with optional phone', () => {
    expect(
      shippingAddressSchema.safeParse({ ...validAddress, phone: '+420123456789' }).success,
    ).toBe(true);
  });

  it('defaults country to CZ when omitted', () => {
    const { country: _, ...rest } = validAddress;
    const result = shippingAddressSchema.parse(rest);
    expect(result.country).toBe('CZ');
  });

  it('rejects missing name', () => {
    const { name: _, ...rest } = validAddress;
    expect(shippingAddressSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing street', () => {
    const { street: _, ...rest } = validAddress;
    expect(shippingAddressSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing city', () => {
    const { city: _, ...rest } = validAddress;
    expect(shippingAddressSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing postalCode', () => {
    const { postalCode: _, ...rest } = validAddress;
    expect(shippingAddressSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects invalid country code (too long)', () => {
    expect(
      shippingAddressSchema.safeParse({ ...validAddress, country: 'CZE' }).success,
    ).toBe(false);
  });

  it('rejects invalid country code (too short)', () => {
    expect(
      shippingAddressSchema.safeParse({ ...validAddress, country: 'C' }).success,
    ).toBe(false);
  });
});

// ─── 6. Type enum value existence ───────────────────────────────────────────

describe('FulfillmentType values', () => {
  it('includes pickup_at_venue, shipping, and digital', () => {
    const values: FulfillmentType[] = ['pickup_at_venue', 'shipping', 'digital'];
    // Compile-time check: if any value is not in FulfillmentType, TS will error.
    // Runtime check: all three are distinct strings.
    expect(new Set(values).size).toBe(3);
  });
});

describe('ProductStatus values', () => {
  it('includes active, paused, and archived', () => {
    const values: ProductStatus[] = ['active', 'paused', 'archived'];
    expect(new Set(values).size).toBe(3);
  });
});

describe('OrderItemStatus values', () => {
  it('includes all six statuses', () => {
    const values: OrderItemStatus[] = [
      'pending',
      'paid',
      'shipped',
      'delivered',
      'refunded',
      'cancelled',
    ];
    expect(new Set(values).size).toBe(6);
  });
});
