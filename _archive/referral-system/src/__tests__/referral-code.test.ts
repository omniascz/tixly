import { describe, it, expect } from 'vitest';
import {
  generateReferralCode,
  isValidReferralCode,
} from '../lib/referral-code.js';

// ============================================================
// referral-code — smoke tests (__tests__ dir)
// Extended coverage in ../lib/referral-code.test.ts
// ============================================================

describe('referral-code — generation', () => {
  it('produces unique strings across many calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = generateReferralCode();
      expect(isValidReferralCode(code)).toBe(true);
      seen.add(code);
    }
    // Birthday-paradox is negligible at 500 / 218 trillion → collision
    // practically impossible. Allow a tiny margin just in case.
    expect(seen.size).toBeGreaterThanOrEqual(499);
  });

  it('generates 8 base62 characters', () => {
    const code = generateReferralCode();
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[a-zA-Z0-9]{8}$/);
  });
});

describe('referral-code — validation', () => {
  it('rejects malformed input', () => {
    expect(isValidReferralCode('')).toBe(false);
    expect(isValidReferralCode('short')).toBe(false);
    expect(isValidReferralCode('too-long-code')).toBe(false);
    expect(isValidReferralCode('abc-defg')).toBe(false);
    expect(isValidReferralCode('abcd efg')).toBe(false);
    expect(isValidReferralCode('čest1234')).toBe(false);
  });

  it('accepts valid 8-char base62 strings', () => {
    expect(isValidReferralCode('AbCd1234')).toBe(true);
    expect(isValidReferralCode('00000000')).toBe(true);
    expect(isValidReferralCode('ZZZZZZZZ')).toBe(true);
  });
});
