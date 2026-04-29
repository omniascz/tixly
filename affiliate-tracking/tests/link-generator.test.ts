import { describe, it, expect } from 'vitest';
import { generateAffiliateCode, isValidAffiliateCode, calculateCommission } from '../src/lib/link-generator';

describe('generateAffiliateCode()', () => {
  it('vygeneruje 8-znakový base62 kód', () => {
    const code = generateAffiliateCode();
    expect(code).toHaveLength(8);
    expect(/^[A-Za-z0-9]{8}$/.test(code)).toBe(true);
  });

  it('generuje unikátní kódy', () => {
    const codes = new Set(Array.from({ length: 1000 }, generateAffiliateCode));
    expect(codes.size).toBe(1000);
  });
});

describe('isValidAffiliateCode()', () => {
  it('přijme platný 8-znakový base62 kód', () => {
    expect(isValidAffiliateCode('AbCd1234')).toBe(true);
    expect(isValidAffiliateCode('ZZZZZZZZ')).toBe(true);
  });

  it('odmítne kratší kód', () => {
    expect(isValidAffiliateCode('Abc123')).toBe(false);
  });

  it('odmítne delší kód', () => {
    expect(isValidAffiliateCode('AbCd12345')).toBe(false);
  });

  it('odmítne speciální znaky', () => {
    expect(isValidAffiliateCode('AbCd-123')).toBe(false);
    expect(isValidAffiliateCode('AbCd_123')).toBe(false);
  });
});

describe('calculateCommission()', () => {
  it('vypočítá 5% komisi správně', () => {
    // 500 bps = 5 %, order 100 000 haléřů (1000 Kč) → 5000 haléřů (50 Kč)
    expect(calculateCommission(100_000, 500)).toBe(5000);
  });

  it('vypočítá 10% komisi', () => {
    expect(calculateCommission(100_000, 1000)).toBe(10_000);
  });

  it('zaokrouhlí dolů (Math.floor)', () => {
    // 333 haléřů × 500 bps = 16.65 haléřů → 16
    expect(calculateCommission(333, 500)).toBe(16);
  });

  it('vrátí 0 pro 0% komisi', () => {
    expect(calculateCommission(100_000, 0)).toBe(0);
  });

  it('vrátí 0 pro 0 Kč objednávku', () => {
    expect(calculateCommission(0, 500)).toBe(0);
  });

  it('50% komise (max realistická)', () => {
    expect(calculateCommission(100_000, 5000)).toBe(50_000);
  });
});
