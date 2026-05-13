import { describe, it, expect } from 'vitest';
import {
  validateThemeForPlan,
  WhiteLabelError,
  isWhiteLabelError,
} from '../lib/plan-enforcement';

describe('plan-enforcement', () => {
  it('1. starter: logoUrl povoleno', () => {
    expect(() =>
      validateThemeForPlan({ logoUrl: 'https://example.com/logo.png' }, 'starter'),
    ).not.toThrow();
  });

  it('2. starter: primaryColor povoleno', () => {
    expect(() =>
      validateThemeForPlan({ primaryColor: '#ff0000' }, 'starter'),
    ).not.toThrow();
  });

  it('3. starter: secondaryColor zakázáno → WhiteLabelError PLAN_FEATURE_NOT_AVAILABLE', () => {
    expect(() =>
      validateThemeForPlan({ secondaryColor: '#ff0000' }, 'starter'),
    ).toThrow(WhiteLabelError);

    try {
      validateThemeForPlan({ secondaryColor: '#ff0000' }, 'starter');
    } catch (err) {
      expect(err instanceof WhiteLabelError).toBe(true);
      expect((err as WhiteLabelError).code).toBe('PLAN_FEATURE_NOT_AVAILABLE');
    }
  });

  it('4. starter: customCss zakázáno', () => {
    expect(() =>
      validateThemeForPlan({ customCss: '.foo { color: red; }' }, 'starter'),
    ).toThrow(WhiteLabelError);
  });

  it('5. pro: secondaryColor povoleno', () => {
    expect(() =>
      validateThemeForPlan({ secondaryColor: '#ff0000' }, 'pro'),
    ).not.toThrow();
  });

  it('6. pro: fontFamily povoleno', () => {
    expect(() =>
      validateThemeForPlan({ fontFamily: 'Roboto' }, 'pro'),
    ).not.toThrow();
  });

  it('7. pro: customCss zakázáno', () => {
    expect(() =>
      validateThemeForPlan({ customCss: '.foo { color: red; }' }, 'pro'),
    ).toThrow(WhiteLabelError);
  });

  it('8. enterprise: customCss povoleno', () => {
    expect(() =>
      validateThemeForPlan({ customCss: '.foo { color: red; }' }, 'enterprise'),
    ).not.toThrow();
  });

  it('9. enterprise: poweredByHidden povoleno', () => {
    expect(() =>
      validateThemeForPlan({ poweredByHidden: true }, 'enterprise'),
    ).not.toThrow();
  });

  it('10. WhiteLabelError má správný statusCode (422)', () => {
    const err = new WhiteLabelError('TEST_CODE', 'Test message');
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('Test message');
    expect(err.name).toBe('WhiteLabelError');
  });

  it('11. WhiteLabelError.toHttpError() vrátí správný tvar', () => {
    const err = new WhiteLabelError('PLAN_FEATURE_NOT_AVAILABLE', 'Feature not available', 422);
    const httpErr = err.toHttpError();
    expect(httpErr).toEqual({
      error: 'PLAN_FEATURE_NOT_AVAILABLE',
      statusCode: 422,
      message: 'Feature not available',
    });
  });

  it('12. isWhiteLabelError detekuje instanci', () => {
    const err = new WhiteLabelError('CODE', 'msg');
    expect(isWhiteLabelError(err)).toBe(true);
    expect(isWhiteLabelError(new Error('regular'))).toBe(false);
    expect(isWhiteLabelError(null)).toBe(false);
    expect(isWhiteLabelError('string')).toBe(false);
  });
});
