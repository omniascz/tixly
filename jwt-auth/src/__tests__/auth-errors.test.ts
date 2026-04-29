import { describe, it, expect } from 'vitest';
import { AuthError, getStatusCode } from '../lib/auth-errors';
import type { AuthErrorCode } from '../lib/auth-errors';

describe('AuthError', () => {
  it('should be an instance of AuthError and Error', () => {
    const err = new AuthError('TOKEN_MISSING');
    expect(err).toBeInstanceOf(AuthError);
    expect(err).toBeInstanceOf(Error);
  });

  it('should have correct status code for TOKEN_MISSING (401)', () => {
    const err = new AuthError('TOKEN_MISSING');
    expect(err.status).toBe(401);
    expect(err.code).toBe('TOKEN_MISSING');
  });

  it('should have correct status code for INSUFFICIENT_ROLE (403)', () => {
    const err = new AuthError('INSUFFICIENT_ROLE');
    expect(err.status).toBe(403);
  });

  it('should have correct status code for PROMOTER_NOT_FOUND (404)', () => {
    const err = new AuthError('PROMOTER_NOT_FOUND');
    expect(err.status).toBe(404);
  });

  it('should have correct status code for ADMIN_REQUIRED (403)', () => {
    const err = new AuthError('ADMIN_REQUIRED');
    expect(err.status).toBe(403);
  });

  it('should have correct status code for TOKEN_EXPIRED (401)', () => {
    const err = new AuthError('TOKEN_EXPIRED');
    expect(err.status).toBe(401);
  });

  it('should have correct status code for TOKEN_REVOKED (401)', () => {
    const err = new AuthError('TOKEN_REVOKED');
    expect(err.status).toBe(401);
  });

  it('should have correct status code for REFRESH_TOKEN_REUSE (401)', () => {
    const err = new AuthError('REFRESH_TOKEN_REUSE');
    expect(err.status).toBe(401);
  });

  it('should have correct status code for NOT_PROMOTER_MEMBER (403)', () => {
    const err = new AuthError('NOT_PROMOTER_MEMBER');
    expect(err.status).toBe(403);
  });

  it('toHttpError() should return correct structure', () => {
    const err = new AuthError('TOKEN_INVALID', 'Custom message');
    const httpErr = err.toHttpError();

    expect(httpErr).toEqual({
      code: 'TOKEN_INVALID',
      message: 'Custom message',
      status: 401,
    });
  });

  it('toHttpError() uses default message when none provided', () => {
    const err = new AuthError('TOKEN_MISSING');
    const httpErr = err.toHttpError();

    expect(httpErr.code).toBe('TOKEN_MISSING');
    expect(typeof httpErr.message).toBe('string');
    expect(httpErr.message.length).toBeGreaterThan(0);
    expect(httpErr.status).toBe(401);
  });

  it('should accept a custom message', () => {
    const customMsg = 'My custom error message';
    const err = new AuthError('USER_NOT_FOUND', customMsg);
    expect(err.message).toBe(customMsg);
  });

  it('getStatusCode() returns correct HTTP status for all codes', () => {
    const cases: Array<[AuthErrorCode, number]> = [
      ['TOKEN_MISSING', 401],
      ['TOKEN_INVALID', 401],
      ['TOKEN_EXPIRED', 401],
      ['TOKEN_REVOKED', 401],
      ['REFRESH_TOKEN_REUSE', 401],
      ['INSUFFICIENT_ROLE', 403],
      ['NOT_PROMOTER_MEMBER', 403],
      ['ADMIN_REQUIRED', 403],
      ['USER_NOT_FOUND', 401],
      ['PROMOTER_NOT_FOUND', 404],
    ];

    for (const [code, expected] of cases) {
      expect(getStatusCode(code)).toBe(expected);
    }
  });
});
