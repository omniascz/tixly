import { describe, it, expect } from 'vitest';
import { RefundError, isRefundError } from '../lib/refund-errors';
import type { RefundErrorCode } from '../lib/refund-errors';

describe('RefundError', () => {
  it('should be instanceof RefundError', () => {
    const err = new RefundError('POLICY_NOT_FOUND');
    expect(err).toBeInstanceOf(RefundError);
    expect(err).toBeInstanceOf(Error);
  });

  it('POLICY_NOT_FOUND has statusCode 404', () => {
    const err = new RefundError('POLICY_NOT_FOUND');
    expect(err.statusCode).toBe(404);
  });

  it('REQUEST_NOT_FOUND has statusCode 404', () => {
    const err = new RefundError('REQUEST_NOT_FOUND');
    expect(err.statusCode).toBe(404);
  });

  it('ORDER_NOT_FOUND has statusCode 404', () => {
    const err = new RefundError('ORDER_NOT_FOUND');
    expect(err.statusCode).toBe(404);
  });

  it('UNAUTHORIZED has statusCode 404 (anti-enumeration)', () => {
    const err = new RefundError('UNAUTHORIZED');
    expect(err.statusCode).toBe(404);
  });

  it('REFUND_NOT_ELIGIBLE has statusCode 422', () => {
    const err = new RefundError('REFUND_NOT_ELIGIBLE');
    expect(err.statusCode).toBe(422);
  });

  it('REFUND_WINDOW_EXPIRED has statusCode 422', () => {
    const err = new RefundError('REFUND_WINDOW_EXPIRED');
    expect(err.statusCode).toBe(422);
  });

  it('SELF_SERVICE_NOT_ALLOWED has statusCode 422', () => {
    const err = new RefundError('SELF_SERVICE_NOT_ALLOWED');
    expect(err.statusCode).toBe(422);
  });

  it('NO_REFUND_POLICY has statusCode 422', () => {
    const err = new RefundError('NO_REFUND_POLICY');
    expect(err.statusCode).toBe(422);
  });

  it('INVALID_AMOUNT has statusCode 422', () => {
    const err = new RefundError('INVALID_AMOUNT');
    expect(err.statusCode).toBe(422);
  });

  it('ALREADY_REFUNDED has statusCode 409', () => {
    const err = new RefundError('ALREADY_REFUNDED');
    expect(err.statusCode).toBe(409);
  });

  it('REQUEST_ALREADY_DECIDED has statusCode 409', () => {
    const err = new RefundError('REQUEST_ALREADY_DECIDED');
    expect(err.statusCode).toBe(409);
  });

  it('DUPLICATE_REQUEST has statusCode 409', () => {
    const err = new RefundError('DUPLICATE_REQUEST');
    expect(err.statusCode).toBe(409);
  });

  it('toHttpError returns correct structure', () => {
    const err = new RefundError('POLICY_NOT_FOUND', 'Policy nenalezena');
    const http = err.toHttpError();
    expect(http).toHaveProperty('error');
    expect(http.error.code).toBe('POLICY_NOT_FOUND');
    expect(http.error.message).toBe('Policy nenalezena');
  });

  it('toHttpError uses code as default message', () => {
    const err = new RefundError('ORDER_NOT_FOUND');
    const http = err.toHttpError();
    expect(http.error.message).toBe('ORDER_NOT_FOUND');
  });

  it('isRefundError returns true for RefundError', () => {
    const err = new RefundError('POLICY_NOT_FOUND');
    expect(isRefundError(err)).toBe(true);
  });

  it('isRefundError returns false for generic Error', () => {
    const err = new Error('generic');
    expect(isRefundError(err)).toBe(false);
  });

  it('code property is accessible', () => {
    const code: RefundErrorCode = 'DUPLICATE_REQUEST';
    const err = new RefundError(code);
    expect(err.code).toBe('DUPLICATE_REQUEST');
  });

  it('name is RefundError', () => {
    const err = new RefundError('POLICY_NOT_FOUND');
    expect(err.name).toBe('RefundError');
  });
});
