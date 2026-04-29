import { describe, it, expect } from 'vitest';
import { PayoutError } from '../lib/payout-errors.js';
import type { PayoutErrorCode } from '../lib/payout-errors.js';

describe('PayoutError', () => {
  it('should be instanceof PayoutError', () => {
    const err = new PayoutError('PAYOUT_NOT_FOUND');
    expect(err).toBeInstanceOf(PayoutError);
    expect(err).toBeInstanceOf(Error);
  });

  it('should have correct statusCode for 404 errors', () => {
    expect(new PayoutError('PAYOUT_NOT_FOUND').statusCode).toBe(404);
    expect(new PayoutError('PAYOUT_SETTINGS_NOT_FOUND').statusCode).toBe(404);
    expect(new PayoutError('SETTLEMENT_NOT_FOUND').statusCode).toBe(404);
  });

  it('should have correct statusCode for 422 errors', () => {
    expect(new PayoutError('INVALID_STATUS_TRANSITION').statusCode).toBe(422);
    expect(new PayoutError('PAYOUT_BELOW_MINIMUM').statusCode).toBe(422);
    expect(new PayoutError('BANK_ACCOUNT_MISSING').statusCode).toBe(422);
  });

  it('should have correct statusCode for 409 errors', () => {
    expect(new PayoutError('ALREADY_PROCESSING').statusCode).toBe(409);
  });

  it('toHttpError() should return correct structure with statusCode and error object', () => {
    const err = new PayoutError('PAYOUT_NOT_FOUND');
    const result = err.toHttpError();

    expect(result).toHaveProperty('statusCode', 404);
    expect(result).toHaveProperty('error');
    expect(result.error).toHaveProperty('code', 'PAYOUT_NOT_FOUND');
    expect(result.error).toHaveProperty('message');
    expect(typeof result.error.message).toBe('string');
    expect(result.error.message.length).toBeGreaterThan(0);
  });

  it('should use custom message when provided', () => {
    const customMsg = 'Vlastní chybová zpráva';
    const err = new PayoutError('PAYOUT_NOT_FOUND', customMsg);
    expect(err.message).toBe(customMsg);
    expect(err.toHttpError().error.message).toBe(customMsg);
  });

  it('should use default message when no custom message provided', () => {
    const err = new PayoutError('BANK_ACCOUNT_MISSING');
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.toHttpError().error.message).toBe(err.message);
  });

  it('should expose code property matching the error code', () => {
    const codes: PayoutErrorCode[] = [
      'PAYOUT_NOT_FOUND',
      'PAYOUT_SETTINGS_NOT_FOUND',
      'SETTLEMENT_NOT_FOUND',
      'INVALID_STATUS_TRANSITION',
      'PAYOUT_BELOW_MINIMUM',
      'ALREADY_PROCESSING',
      'BANK_ACCOUNT_MISSING',
      'UNAUTHORIZED',
    ];
    for (const code of codes) {
      const err = new PayoutError(code);
      expect(err.code).toBe(code);
    }
  });

  it('should have name set to PayoutError', () => {
    const err = new PayoutError('PAYOUT_NOT_FOUND');
    expect(err.name).toBe('PayoutError');
  });
});
