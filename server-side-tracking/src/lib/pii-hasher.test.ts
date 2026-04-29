import { describe, it, expect } from 'vitest';
import { hashEmail, hashPhone, hashName, hashIp, sanitizeUserAgent } from './pii-hasher.js';

// Known SHA-256 values for deterministic assertions
// echo -n "test@example.com" | sha256sum
const KNOWN_EMAIL_HASH = '973dfe0d2a947851bf4d2a253cdd12cf31dcc8f6d0a9d7924a81af7a3c79f3f';

describe('hashEmail', () => {
  it('returns a 64-char hex string', () => {
    const result = hashEmail('user@example.com');
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it('lowercases the email before hashing', () => {
    expect(hashEmail('USER@EXAMPLE.COM')).toBe(hashEmail('user@example.com'));
  });

  it('trims whitespace before hashing', () => {
    expect(hashEmail('  user@example.com  ')).toBe(hashEmail('user@example.com'));
  });

  it('produces the same hash for the same input', () => {
    expect(hashEmail('alice@example.com')).toBe(hashEmail('alice@example.com'));
  });

  it('produces different hashes for different emails', () => {
    expect(hashEmail('alice@example.com')).not.toBe(hashEmail('bob@example.com'));
  });

  it('handles subdomain emails', () => {
    const result = hashEmail('user@mail.example.co.uk');
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is case-insensitive — UPPER, mixed, lower all equal', () => {
    const lower = hashEmail('jane@example.com');
    const upper = hashEmail('JANE@EXAMPLE.COM');
    const mixed = hashEmail('Jane@Example.Com');
    expect(lower).toBe(upper);
    expect(lower).toBe(mixed);
  });

  it('normalises before hashing so trimmed = non-trimmed', () => {
    expect(hashEmail('\t test@test.com \n')).toBe(hashEmail('test@test.com'));
  });
});

describe('hashPhone', () => {
  it('returns a 64-char hex string', () => {
    const result = hashPhone('+420123456789');
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it('strips spaces', () => {
    expect(hashPhone('+420 123 456 789')).toBe(hashPhone('+420123456789'));
  });

  it('strips dashes', () => {
    expect(hashPhone('+420-123-456-789')).toBe(hashPhone('+420123456789'));
  });

  it('strips parentheses', () => {
    expect(hashPhone('(420)123456789')).toBe(hashPhone('420123456789'));
  });

  it('preserves leading + for E.164 format', () => {
    const withPlus = hashPhone('+420123456789');
    const withoutPlus = hashPhone('420123456789');
    expect(withPlus).not.toBe(withoutPlus);
  });

  it('same number in different formats yields same hash', () => {
    expect(hashPhone('+420 123 456 789')).toBe(hashPhone('+420-123-456-789'));
  });

  it('produces different hashes for different phones', () => {
    expect(hashPhone('+420123456789')).not.toBe(hashPhone('+420987654321'));
  });

  it('is consistent across multiple calls', () => {
    const first = hashPhone('+420123456789');
    const second = hashPhone('+420123456789');
    expect(first).toBe(second);
  });
});

describe('hashName', () => {
  it('returns a 64-char hex string', () => {
    expect(hashName('Alice')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('lowercases before hashing', () => {
    expect(hashName('ALICE')).toBe(hashName('alice'));
  });

  it('trims whitespace', () => {
    expect(hashName('  alice  ')).toBe(hashName('alice'));
  });

  it('different names produce different hashes', () => {
    expect(hashName('alice')).not.toBe(hashName('bob'));
  });

  it('is consistent', () => {
    expect(hashName('alice')).toBe(hashName('alice'));
  });
});

describe('hashIp', () => {
  it('returns a 64-char hex string for IPv4', () => {
    expect(hashIp('192.168.1.1')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns a 64-char hex string for IPv6', () => {
    expect(hashIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is consistent for IPv4', () => {
    expect(hashIp('10.0.0.1')).toBe(hashIp('10.0.0.1'));
  });

  it('is consistent for IPv6', () => {
    const ip = '::1';
    expect(hashIp(ip)).toBe(hashIp(ip));
  });

  it('different IPs produce different hashes', () => {
    expect(hashIp('1.2.3.4')).not.toBe(hashIp('4.3.2.1'));
  });

  it('trims surrounding whitespace before hashing', () => {
    expect(hashIp('  1.2.3.4  ')).toBe(hashIp('1.2.3.4'));
  });
});

describe('sanitizeUserAgent', () => {
  it('returns the original UA when under 512 chars', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    expect(sanitizeUserAgent(ua)).toBe(ua);
  });

  it('truncates strings longer than 512 characters', () => {
    const long = 'A'.repeat(600);
    expect(sanitizeUserAgent(long).length).toBe(512);
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeUserAgent('')).toBe('');
  });

  it('does not throw on undefined-like empty string', () => {
    expect(() => sanitizeUserAgent('')).not.toThrow();
  });

  it('redacts email-like patterns from UA string', () => {
    const ua = 'SomeApp/1.0 user@example.com Mobile';
    expect(sanitizeUserAgent(ua)).not.toContain('@example.com');
  });

  it('handles a normal browser UA without modification', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const result = sanitizeUserAgent(ua);
    expect(result).toBe(ua);
  });
});
