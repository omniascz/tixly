import { describe, it, expect } from 'vitest';
import { UpsellError } from '../lib/upsell-errors.js';
import type { UpsellErrorCode } from '../lib/upsell-errors.js';

describe('UpsellError', () => {
  it('extends Error', () => {
    const err = new UpsellError('UPSELL_NOT_FOUND', 'Not found', 404);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UpsellError);
  });

  it('sets name to UpsellError', () => {
    const err = new UpsellError('UPSELL_NOT_FOUND', 'Not found', 404);
    expect(err.name).toBe('UpsellError');
  });

  it('toHttpError returns correct structure', () => {
    const err = new UpsellError('UPSELL_SOLD_OUT', 'Item is sold out', 409);
    const result = err.toHttpError();
    expect(result).toEqual({
      error: {
        code: 'UPSELL_SOLD_OUT',
        message: 'Item is sold out',
      },
    });
  });

  it('each standard error code maps to expected statusCode', () => {
    const cases: Array<[UpsellErrorCode, number]> = [
      ['ORDER_NOT_FOUND', 404],
      ['UPSELL_NOT_FOUND', 404],
      ['UPSELL_SOLD_OUT', 409],
      ['UPSELL_NOT_AVAILABLE', 422],
      ['MAX_PER_ORDER_EXCEEDED', 422],
      ['DUPLICATE_UPSELL', 409],
      ['TIME_WINDOW_CLOSED', 422],
      ['UNAUTHORIZED', 403],
      ['EVENT_NOT_FOUND', 404],
      ['VIP_NOT_AVAILABLE', 422],
      ['VIP_UPGRADE_NO_SURCHARGE', 422],
    ];

    for (const [code, expectedStatus] of cases) {
      const err = new UpsellError(code, 'test', expectedStatus);
      expect(err.statusCode).toBe(expectedStatus);
      expect(err.code).toBe(code);
    }
  });

  it('message is accessible on error instance', () => {
    const err = new UpsellError('UNAUTHORIZED', 'You are not authorized', 403);
    expect(err.message).toBe('You are not authorized');
  });
});
