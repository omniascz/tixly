import { describe, it, expect } from 'vitest';
import { PlatformError, isPlatformError } from '../lib/platform-errors.js';

describe('PlatformError', () => {
  it('PROMOTER_NOT_FOUND has statusCode 404', () => {
    const err = new PlatformError('PROMOTER_NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('PROMOTER_NOT_FOUND');
  });

  it('PROMOTER_SLUG_TAKEN has statusCode 409', () => {
    const err = new PlatformError('PROMOTER_SLUG_TAKEN');
    expect(err.statusCode).toBe(409);
  });

  it('CANNOT_REMOVE_OWNER has statusCode 422', () => {
    const err = new PlatformError('CANNOT_REMOVE_OWNER');
    expect(err.statusCode).toBe(422);
  });

  it('UNAUTHORIZED has statusCode 404 (anti-enumeration)', () => {
    const err = new PlatformError('UNAUTHORIZED');
    expect(err.statusCode).toBe(404);
  });

  it('KYC_NOT_VERIFIED has statusCode 422', () => {
    const err = new PlatformError('KYC_NOT_VERIFIED');
    expect(err.statusCode).toBe(422);
  });

  it('INVALID_STATUS_TRANSITION has statusCode 422', () => {
    const err = new PlatformError('INVALID_STATUS_TRANSITION');
    expect(err.statusCode).toBe(422);
  });

  it('MEMBER_ALREADY_EXISTS has statusCode 409', () => {
    const err = new PlatformError('MEMBER_ALREADY_EXISTS');
    expect(err.statusCode).toBe(409);
  });

  it('toHttpError() returns correct structure', () => {
    const err = new PlatformError('PROMOTER_NOT_FOUND', 'Custom message');
    const http = err.toHttpError();
    expect(http).toEqual({
      statusCode: 404,
      code: 'PROMOTER_NOT_FOUND',
      message: 'Custom message',
    });
  });

  it('instanceof PlatformError works correctly', () => {
    const err = new PlatformError('MEMBER_NOT_FOUND');
    expect(err instanceof PlatformError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('isPlatformError helper identifies PlatformError', () => {
    const err = new PlatformError('PROMOTER_SUSPENDED');
    expect(isPlatformError(err)).toBe(true);
    expect(isPlatformError(new Error('regular'))).toBe(false);
    expect(isPlatformError(null)).toBe(false);
    expect(isPlatformError('string')).toBe(false);
  });
});
