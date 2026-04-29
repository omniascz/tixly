import { describe, it, expect } from 'vitest';
import { MerchandiseError, isMerchandiseError } from '../lib/merchandise-errors';
import type { MerchandiseErrorCode } from '../lib/merchandise-errors';

describe('MerchandiseError', () => {
  const cases: Array<[MerchandiseErrorCode, number]> = [
    ['PRODUCT_NOT_FOUND', 404],
    ['VARIANT_NOT_FOUND', 404],
    ['VARIANT_SOLD_OUT', 409],
    ['INSUFFICIENT_STOCK', 409],
    ['ORDER_NOT_FOUND', 404],
    ['ORDER_ITEM_NOT_FOUND', 404],
    ['DUPLICATE_ORDER', 409],
    ['UNAUTHORIZED', 404],     // anti-enumeration
    ['SHIPPING_REQUIRED', 422],
    ['CANCEL_NOT_ALLOWED', 422],
    ['INVALID_QUANTITY', 422],
  ];

  it.each(cases)('%s has statusCode %i', (code, expectedStatus) => {
    const err = new MerchandiseError(code);
    expect(err.statusCode).toBe(expectedStatus);
  });

  it('toHttpError() returns correct structure', () => {
    const err = new MerchandiseError('VARIANT_SOLD_OUT', 'Variant XYZ is sold out');
    const httpErr = err.toHttpError();
    expect(httpErr).toEqual({
      statusCode: 409,
      code: 'VARIANT_SOLD_OUT',
      message: 'Variant XYZ is sold out',
    });
  });

  it('toHttpError() uses code as default message when no message provided', () => {
    const err = new MerchandiseError('PRODUCT_NOT_FOUND');
    const httpErr = err.toHttpError();
    expect(httpErr.message).toBe('PRODUCT_NOT_FOUND');
    expect(httpErr.statusCode).toBe(404);
  });

  it('instanceof MerchandiseError works correctly', () => {
    const err = new MerchandiseError('SHIPPING_REQUIRED');
    expect(err).toBeInstanceOf(MerchandiseError);
    expect(err).toBeInstanceOf(Error);
  });

  it('isMerchandiseError type guard works', () => {
    const err = new MerchandiseError('CANCEL_NOT_ALLOWED');
    expect(isMerchandiseError(err)).toBe(true);
    expect(isMerchandiseError(new Error('regular error'))).toBe(false);
    expect(isMerchandiseError('string')).toBe(false);
    expect(isMerchandiseError(null)).toBe(false);
  });
});
