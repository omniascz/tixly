import { describe, it, expect } from 'vitest';
import { AdminError, isAdminError } from '../lib/admin-errors';
import type { AdminErrorCode } from '../lib/admin-errors';

describe('AdminError', () => {
  it('should be instanceof AdminError', () => {
    const err = new AdminError('PROMOTER_NOT_FOUND', 'Not found');
    expect(err).toBeInstanceOf(AdminError);
    expect(err).toBeInstanceOf(Error);
  });

  it('PROMOTER_NOT_FOUND → statusCode 404', () => {
    const err = new AdminError('PROMOTER_NOT_FOUND', 'Promoter not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('PROMOTER_NOT_FOUND');
  });

  it('PAYOUT_NOT_FOUND → statusCode 404', () => {
    const err = new AdminError('PAYOUT_NOT_FOUND', 'Payout not found');
    expect(err.statusCode).toBe(404);
  });

  it('NOTIFICATION_NOT_FOUND → statusCode 404', () => {
    const err = new AdminError('NOTIFICATION_NOT_FOUND', 'Notification not found');
    expect(err.statusCode).toBe(404);
  });

  it('INVALID_ACTION → statusCode 422', () => {
    const err = new AdminError('INVALID_ACTION', 'Invalid action');
    expect(err.statusCode).toBe(422);
  });

  it('BULK_PARTIALLY_FAILED → statusCode 207', () => {
    const err = new AdminError('BULK_PARTIALLY_FAILED', 'Partial failure');
    expect(err.statusCode).toBe(207);
  });

  it('UNAUTHORIZED → statusCode 401', () => {
    const err = new AdminError('UNAUTHORIZED', 'Unauthorized');
    expect(err.statusCode).toBe(401);
  });

  it('toHttpError() returns correct structure without details', () => {
    const err = new AdminError('INVALID_ACTION', 'Bad action');
    const http = err.toHttpError();
    expect(http).toEqual({ error: 'Bad action', code: 'INVALID_ACTION' });
    expect(http).not.toHaveProperty('details');
  });

  it('toHttpError() includes details when provided', () => {
    const err = new AdminError('BULK_PARTIALLY_FAILED', 'Partial', { count: 3 });
    const http = err.toHttpError();
    expect(http.details).toEqual({ count: 3 });
    expect(http.code).toBe('BULK_PARTIALLY_FAILED');
    expect(http.error).toBe('Partial');
  });

  it('error.name is AdminError', () => {
    const err = new AdminError('UNAUTHORIZED', 'Unauth');
    expect(err.name).toBe('AdminError');
  });

  it('error.message matches constructor message', () => {
    const err = new AdminError('PROMOTER_NOT_FOUND', 'Custom message');
    expect(err.message).toBe('Custom message');
  });

  it('isAdminError returns true for AdminError', () => {
    const err = new AdminError('UNAUTHORIZED', 'Unauth');
    expect(isAdminError(err)).toBe(true);
  });

  it('isAdminError returns false for plain Error', () => {
    const err = new Error('plain');
    expect(isAdminError(err)).toBe(false);
  });

  it('isAdminError returns false for non-error values', () => {
    expect(isAdminError(null)).toBe(false);
    expect(isAdminError('string')).toBe(false);
    expect(isAdminError(42)).toBe(false);
  });
});
