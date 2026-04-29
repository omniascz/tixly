import { describe, it, expect } from 'vitest';
import { validatePhone, stripPlus, normalizePhone } from './phone.js';

describe('validatePhone', () => {
  it('returns normalized E.164 with leading +', () => {
    expect(validatePhone('420601123456')).toBe('+420601123456');
  });

  it('keeps existing + prefix', () => {
    expect(validatePhone('+420601123456')).toBe('+420601123456');
  });

  it('strips whitespace before validating', () => {
    expect(validatePhone('+420 601 123 456')).toBe('+420601123456');
  });

  it('rejects empty string', () => {
    expect(() => validatePhone('')).toThrow();
  });

  it('rejects too-short number', () => {
    expect(() => validatePhone('+1234')).toThrow();
  });

  it('rejects too-long number', () => {
    expect(() => validatePhone('+1234567890123456')).toThrow();
  });

  it('rejects number starting with 0', () => {
    expect(() => validatePhone('+0420601123456')).toThrow();
  });

  it('rejects letters', () => {
    expect(() => validatePhone('+420abc123')).toThrow();
  });

  it('rejects non-string input', () => {
    expect(() => validatePhone(undefined as unknown as string)).toThrow();
    expect(() => validatePhone(42 as unknown as string)).toThrow();
  });

  it('accepts minimum valid length (8 digits)', () => {
    expect(validatePhone('+12345678')).toBe('+12345678');
  });

  it('accepts maximum valid length (15 digits)', () => {
    expect(validatePhone('+123456789012345')).toBe('+123456789012345');
  });
});

describe('stripPlus', () => {
  it('removes leading +', () => {
    expect(stripPlus('+420601123456')).toBe('420601123456');
  });

  it('returns unchanged if no +', () => {
    expect(stripPlus('420601123456')).toBe('420601123456');
  });

  it('handles empty string', () => {
    expect(stripPlus('')).toBe('');
  });
});

describe('normalizePhone', () => {
  it('removes + and non-digits', () => {
    expect(normalizePhone('+420-601-123-456')).toBe('420601123456');
  });

  it('removes spaces', () => {
    expect(normalizePhone('+420 601 123 456')).toBe('420601123456');
  });

  it('removes parentheses and dashes', () => {
    expect(normalizePhone('+1 (555) 123-4567')).toBe('15551234567');
  });

  it('returns digits-only if already clean', () => {
    expect(normalizePhone('420601123456')).toBe('420601123456');
  });
});
