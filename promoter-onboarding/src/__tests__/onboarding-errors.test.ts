import { describe, it, expect } from 'vitest';
import { OnboardingError, isOnboardingError } from '../lib/onboarding-errors';
import type { OnboardingErrorCode } from '../lib/onboarding-errors';

describe('OnboardingError', () => {
  it('is an instance of Error and OnboardingError', () => {
    const err = new OnboardingError('EMAIL_ALREADY_REGISTERED');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OnboardingError);
    expect(isOnboardingError(err)).toBe(true);
  });

  it('isOnboardingError returns false for plain Error', () => {
    expect(isOnboardingError(new Error('plain'))).toBe(false);
    expect(isOnboardingError('string')).toBe(false);
    expect(isOnboardingError(null)).toBe(false);
  });

  it('maps 409 status codes correctly', () => {
    const cases: OnboardingErrorCode[] = ['EMAIL_ALREADY_REGISTERED', 'PROMOTER_ALREADY_EXISTS', 'KYC_ALREADY_SUBMITTED'];
    for (const code of cases) {
      expect(new OnboardingError(code).statusCode).toBe(409);
    }
  });

  it('maps 422 status codes correctly', () => {
    const cases: OnboardingErrorCode[] = [
      'EMAIL_NOT_VERIFIED',
      'INVALID_ICO',
      'INVALID_IBAN',
      'KYC_NOT_SUBMITTED',
      'INVALID_REVIEW_DECISION',
      'NOTES_REQUIRED',
    ];
    for (const code of cases) {
      expect(new OnboardingError(code).statusCode).toBe(422);
    }
  });

  it('maps 400 status codes correctly', () => {
    const cases: OnboardingErrorCode[] = [
      'VERIFICATION_TOKEN_INVALID',
      'VERIFICATION_TOKEN_EXPIRED',
      'VERIFICATION_TOKEN_USED',
    ];
    for (const code of cases) {
      expect(new OnboardingError(code).statusCode).toBe(400);
    }
  });

  it('maps 404 status code for ONBOARDING_NOT_FOUND', () => {
    expect(new OnboardingError('ONBOARDING_NOT_FOUND').statusCode).toBe(404);
  });

  it('toHttpError() returns correct structure', () => {
    const err = new OnboardingError('EMAIL_ALREADY_REGISTERED');
    const httpError = err.toHttpError();
    expect(httpError).toEqual({
      error: 'EMAIL_ALREADY_REGISTERED',
      message: expect.any(String),
      statusCode: 409,
    });
    expect(httpError.message.length).toBeGreaterThan(0);
  });

  it('accepts custom message override', () => {
    const err = new OnboardingError('INVALID_ICO', 'Custom IČO message');
    expect(err.message).toBe('Custom IČO message');
    expect(err.toHttpError().message).toBe('Custom IČO message');
  });

  it('has correct code property', () => {
    const err = new OnboardingError('NOTES_REQUIRED');
    expect(err.code).toBe('NOTES_REQUIRED');
  });

  it('name is OnboardingError', () => {
    expect(new OnboardingError('UNAUTHORIZED').name).toBe('OnboardingError');
  });
});
