import { describe, it, expect } from 'vitest';
import {
  generateReferralCode,
  encodeBase62,
  isValidReferralCode,
  buildReferralUrl,
} from './referral-code';

// ============================================================
// referral-code.ts — unit tests
// ============================================================

describe('generateReferralCode', () => {
  it('returns a string of exactly 8 characters', () => {
    const code = generateReferralCode();
    expect(code).toHaveLength(8);
  });

  it('only contains base62 characters [a-zA-Z0-9]', () => {
    const code = generateReferralCode();
    expect(/^[a-zA-Z0-9]{8}$/.test(code)).toBe(true);
  });

  it('produces 8-character codes on 100 consecutive calls', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateReferralCode();
      expect(code).toHaveLength(8);
      expect(/^[a-zA-Z0-9]{8}$/.test(code)).toBe(true);
    }
  });

  it('generates no duplicates in 1000 calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = generateReferralCode();
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
    expect(seen.size).toBe(1000);
  });
});

describe('encodeBase62', () => {
  it('returns exactly CODE_LENGTH (8) characters', () => {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x01]);
    expect(encodeBase62(buf)).toHaveLength(8);
  });

  it('encodes a zero buffer to all-zero characters', () => {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(encodeBase62(buf)).toBe('00000000');
  });

  it('produces only base62 characters for arbitrary buffers', () => {
    const buffers = [
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]),
      Buffer.from([0xab, 0xcd, 0xef, 0x01, 0x23, 0x45]),
    ];
    for (const buf of buffers) {
      expect(/^[a-zA-Z0-9]{8}$/.test(encodeBase62(buf))).toBe(true);
    }
  });

  it('is deterministic — same buffer gives same code', () => {
    const buf = Buffer.from([0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]);
    expect(encodeBase62(buf)).toBe(encodeBase62(buf));
  });
});

describe('isValidReferralCode', () => {
  it('returns true for a valid 8-char alphanumeric code', () => {
    expect(isValidReferralCode('AbCd1234')).toBe(true);
  });

  it('returns true for all lowercase', () => {
    expect(isValidReferralCode('abcdefgh')).toBe(true);
  });

  it('returns true for all uppercase', () => {
    expect(isValidReferralCode('ABCDEFGH')).toBe(true);
  });

  it('returns true for all digits', () => {
    expect(isValidReferralCode('12345678')).toBe(true);
  });

  it('returns false for code shorter than 8 characters', () => {
    expect(isValidReferralCode('Abc123')).toBe(false);
  });

  it('returns false for code longer than 8 characters', () => {
    expect(isValidReferralCode('AbCd12345')).toBe(false);
  });

  it('returns false for code containing a hyphen', () => {
    expect(isValidReferralCode('AbCd-234')).toBe(false);
  });

  it('returns false for code containing an underscore', () => {
    expect(isValidReferralCode('AbCd_234')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidReferralCode('')).toBe(false);
  });

  it('returns false for code with a space', () => {
    expect(isValidReferralCode('AbCd 234')).toBe(false);
  });
});

describe('buildReferralUrl', () => {
  const BASE = 'https://tixly.cz';

  it('builds a URL with the correct /ref/<code> path', () => {
    const url = buildReferralUrl('AbCd1234', BASE);
    expect(url).toContain('/ref/AbCd1234');
  });

  it('includes utm_source=referral', () => {
    const url = buildReferralUrl('AbCd1234', BASE);
    expect(url).toContain('utm_source=referral');
  });

  it('includes utm_medium=referral', () => {
    const url = buildReferralUrl('AbCd1234', BASE);
    expect(url).toContain('utm_medium=referral');
  });

  it('includes utm_campaign when campaignId is provided', () => {
    const url = buildReferralUrl('AbCd1234', BASE, 'spring-sale');
    expect(url).toContain('utm_campaign=spring-sale');
  });

  it('does NOT include utm_campaign when campaignId is omitted', () => {
    const url = buildReferralUrl('AbCd1234', BASE);
    expect(url).not.toContain('utm_campaign');
  });

  it('uses the provided base URL as the origin', () => {
    const url = buildReferralUrl('AbCd1234', 'https://example.com');
    expect(url.startsWith('https://example.com')).toBe(true);
  });

  it('produces a valid URL', () => {
    const url = buildReferralUrl('AbCd1234', BASE, 'test');
    expect(() => new URL(url)).not.toThrow();
  });
});
