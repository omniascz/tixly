import { describe, it, expect } from 'vitest';
import { generateTotpCode, verifyTotpCode } from './verify';

// Test vectors from RFC 6238 Appendix B (SHA-1, ASCII secret "12345678901234567890" → bytes)
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('generateTotpCode', () => {
  it('matches RFC 6238 vector at T=59 (code: 287082)', () => {
    expect(generateTotpCode(RFC_SECRET, new Date(59 * 1000))).toBe('287082');
  });

  it('matches RFC 6238 vector at T=1111111109 (code: 081804)', () => {
    expect(generateTotpCode(RFC_SECRET, new Date(1111111109 * 1000))).toBe('081804');
  });

  it('matches RFC 6238 vector at T=1234567890 (code: 005924)', () => {
    expect(generateTotpCode(RFC_SECRET, new Date(1234567890 * 1000))).toBe('005924');
  });

  it('produces 6-digit zero-padded output', () => {
    const code = generateTotpCode(Buffer.from('seed'));
    expect(code).toMatch(/^\d{6}$/);
  });
});

describe('verifyTotpCode', () => {
  it('accepts current code', () => {
    const now = new Date();
    const code = generateTotpCode(RFC_SECRET, now);
    expect(verifyTotpCode(code, RFC_SECRET, { atDate: now })).toBe(true);
  });

  it('accepts previous step within window', () => {
    const now = new Date(60_000);
    const previous = generateTotpCode(RFC_SECRET, new Date(30_000));
    expect(verifyTotpCode(previous, RFC_SECRET, { atDate: now })).toBe(true);
  });

  it('accepts next step within window (clock drift)', () => {
    const now = new Date(60_000);
    const next = generateTotpCode(RFC_SECRET, new Date(90_000));
    expect(verifyTotpCode(next, RFC_SECRET, { atDate: now })).toBe(true);
  });

  it('rejects code outside window', () => {
    const now = new Date(0);
    const future = generateTotpCode(RFC_SECRET, new Date(120_000));
    expect(verifyTotpCode(future, RFC_SECRET, { atDate: now })).toBe(false);
  });

  it('rejects malformed code', () => {
    expect(verifyTotpCode('abc123', RFC_SECRET)).toBe(false);
    expect(verifyTotpCode('12345', RFC_SECRET)).toBe(false);
    expect(verifyTotpCode('1234567', RFC_SECRET)).toBe(false);
  });

  it('rejects wrong secret', () => {
    const now = new Date();
    const code = generateTotpCode(RFC_SECRET, now);
    expect(verifyTotpCode(code, Buffer.from('wrong'), { atDate: now })).toBe(false);
  });

  it('window=0 rejects neighbouring steps', () => {
    const now = new Date(60_000);
    const previous = generateTotpCode(RFC_SECRET, new Date(30_000));
    expect(verifyTotpCode(previous, RFC_SECRET, { atDate: now, window: 0 })).toBe(false);
  });
});
