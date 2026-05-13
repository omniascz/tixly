import { describe, it, expect } from 'vitest';
import { formatPrice, formatDate } from '../lib/format';

describe('formatPrice', () => {
  it('converts 9900 haléřů to "99 Kč"', () => {
    expect(formatPrice(9900)).toBe('99 Kč');
  });

  it('converts 150000 haléřů to "1 500 Kč"', () => {
    expect(formatPrice(150000)).toBe('1 500 Kč');
  });

  it('converts 0 haléřů to "0 Kč"', () => {
    expect(formatPrice(0)).toBe('0 Kč');
  });

  it('converts 100 haléřů (1 Kč) correctly', () => {
    expect(formatPrice(100)).toBe('1 Kč');
  });

  it('handles large numbers with thousands separator', () => {
    expect(formatPrice(100000000)).toBe('1 000 000 Kč');
  });

  it('converts 25000 haléřů to "250 Kč"', () => {
    expect(formatPrice(25000)).toBe('250 Kč');
  });

  it('converts 1234567 haléřů (12345.67 Kč → floors to 12345)', () => {
    // 1234567 haléřů = 12345 Kč (floor division)
    expect(formatPrice(1234567)).toBe('12 345 Kč');
  });
});

describe('formatDate', () => {
  it('formats UTC time to Europe/Prague timezone', () => {
    // 2026-05-10T17:00:00.000Z = 2026-05-10 19:00 CEST (UTC+2)
    expect(formatDate('2026-05-10T17:00:00.000Z')).toBe('10. 5. 2026 19:00');
  });

  it('handles winter time (UTC+1)', () => {
    // 2026-01-15T18:00:00.000Z = 2026-01-15 19:00 CET (UTC+1)
    expect(formatDate('2026-01-15T18:00:00.000Z')).toBe('15. 1. 2026 19:00');
  });

  it('handles midnight correctly', () => {
    // 2026-06-20T22:00:00.000Z = 2026-06-21 00:00 CEST (UTC+2)
    expect(formatDate('2026-06-20T22:00:00.000Z')).toBe('21. 6. 2026 00:00');
  });

  it('formats single-digit day and month without leading zeros', () => {
    // Czech locale uses "1. 6." not "01. 06."
    const result = formatDate('2026-06-01T10:00:00.000Z');
    expect(result).toMatch(/^1\. 6\. 2026/);
  });
});
