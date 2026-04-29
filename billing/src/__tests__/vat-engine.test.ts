/**
 * VAT engine tests — Czech VAT calculation, reverse charge, scheme detection.
 * Ported from @acc/accounting vat-engine.test.ts, adapted for haléře.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateVat,
  calculateVatFromGross,
  isReverseCharge,
  determineVatScheme,
  validateDic,
  isEuCountry,
  CZ_VAT_RATES_BP,
  CZ_VAT_RATES_PERCENT,
} from '../lib/vat-engine.js';

describe('calculateVat', () => {
  it('calculates 21% VAT correctly', () => {
    // 10000 haléřů (100 Kč) × 21% = 2100 haléřů
    const result = calculateVat(10000, 'standard');
    expect(result.baseHalire).toBe(10000);
    expect(result.vatHalire).toBe(2100);
    expect(result.totalHalire).toBe(12100);
    expect(result.effectiveRateBp).toBe(2100);
  });

  it('calculates 12% VAT correctly', () => {
    const result = calculateVat(10000, 'reduced');
    expect(result.baseHalire).toBe(10000);
    expect(result.vatHalire).toBe(1200);
    expect(result.totalHalire).toBe(11200);
    expect(result.effectiveRateBp).toBe(1200);
  });

  it('calculates 0% VAT', () => {
    const result = calculateVat(10000, 'zero');
    expect(result.vatHalire).toBe(0);
    expect(result.totalHalire).toBe(10000);
  });

  it('rounds correctly on odd amounts', () => {
    // 12345 × 21% = 2592.45 → 2592 (Math.round)
    const result = calculateVat(12345, 'standard');
    expect(result.vatHalire).toBe(2592);
    expect(result.totalHalire).toBe(14937);
  });

  it('returns zero VAT for reverse_charge scheme', () => {
    const result = calculateVat(10000, 'standard', 'reverse_charge');
    expect(result.vatHalire).toBe(0);
    expect(result.totalHalire).toBe(10000);
    expect(result.effectiveRateBp).toBe(0);
  });

  it('returns zero VAT for exempt scheme', () => {
    const result = calculateVat(10000, 'standard', 'exempt');
    expect(result.vatHalire).toBe(0);
  });

  it('returns zero VAT for non_vat scheme', () => {
    const result = calculateVat(5000, 'standard', 'non_vat');
    expect(result.vatHalire).toBe(0);
    expect(result.totalHalire).toBe(5000);
  });

  it('returns zero VAT for third_country scheme', () => {
    const result = calculateVat(10000, 'standard', 'third_country');
    expect(result.vatHalire).toBe(0);
  });

  it('returns zero VAT for intra_eu scheme', () => {
    const result = calculateVat(10000, 'standard', 'intra_eu');
    expect(result.vatHalire).toBe(0);
  });

  it('standard scheme applies VAT normally', () => {
    const result = calculateVat(10000, 'standard', 'standard');
    expect(result.vatHalire).toBe(2100);
  });

  it('throws on non-integer input', () => {
    expect(() => calculateVat(100.5, 'standard')).toThrow('must be integer');
  });
});

describe('calculateVatFromGross', () => {
  it('reverse-calculates base and VAT from gross at 21%', () => {
    // 12100 gross at 21%: base = 12100 × 10000/12100 = 10000
    const result = calculateVatFromGross(12100, 'standard');
    expect(result.baseHalire).toBe(10000);
    expect(result.vatHalire).toBe(2100);
  });

  it('reverse-calculates at 12%', () => {
    const result = calculateVatFromGross(11200, 'reduced');
    expect(result.baseHalire).toBe(10000);
    expect(result.vatHalire).toBe(1200);
  });

  it('handles zero rate — base equals gross', () => {
    const result = calculateVatFromGross(10000, 'zero');
    expect(result.baseHalire).toBe(10000);
    expect(result.vatHalire).toBe(0);
  });

  it('handles odd gross amounts with rounding', () => {
    // 15000 gross at 21%: base = round(15000 × 10000 / 12100) = 12397
    const result = calculateVatFromGross(15000, 'standard');
    expect(result.baseHalire + result.vatHalire).toBe(15000);
    expect(result.baseHalire).toBe(12397);
    expect(result.vatHalire).toBe(2603);
  });

  it('throws on non-integer input', () => {
    expect(() => calculateVatFromGross(100.5, 'standard')).toThrow('must be integer');
  });
});

describe('isReverseCharge', () => {
  it('CZ→CZ with construction category = true', () => {
    expect(isReverseCharge('CZ', 'CZ', 'construction')).toBe(true);
  });

  it('CZ→CZ without category = false', () => {
    expect(isReverseCharge('CZ', 'CZ')).toBe(false);
  });

  it('CZ→CZ with unknown category = false', () => {
    expect(isReverseCharge('CZ', 'CZ', 'unknown')).toBe(false);
  });

  it('EU→CZ always = true', () => {
    expect(isReverseCharge('DE', 'CZ')).toBe(true);
    expect(isReverseCharge('SK', 'CZ')).toBe(true);
  });

  it('US→CZ = false (third country)', () => {
    expect(isReverseCharge('US', 'CZ')).toBe(false);
  });

  it('CZ→DE = false (not applicable)', () => {
    expect(isReverseCharge('CZ', 'DE')).toBe(false);
  });
});

describe('determineVatScheme', () => {
  it('CZ→CZ VAT payer = standard', () => {
    expect(determineVatScheme('CZ', 'CZ', true, true)).toBe('standard');
  });

  it('non-VAT supplier = non_vat', () => {
    expect(determineVatScheme('CZ', 'CZ', false, true)).toBe('non_vat');
  });

  it('CZ→CZ with RC category = reverse_charge', () => {
    expect(determineVatScheme('CZ', 'CZ', true, true, 'waste')).toBe('reverse_charge');
  });

  it('DE→CZ = intra_eu', () => {
    expect(determineVatScheme('DE', 'CZ', true, true)).toBe('intra_eu');
  });

  it('US→CZ = third_country', () => {
    expect(determineVatScheme('US', 'CZ', true, true)).toBe('third_country');
  });

  it('CZ→US = third_country', () => {
    expect(determineVatScheme('CZ', 'US', true, true)).toBe('third_country');
  });
});

describe('validateDic', () => {
  it('accepts valid CZ DIČ (8 digits)', () => {
    expect(validateDic('CZ12345678')).toBe(true);
  });

  it('accepts valid CZ DIČ (10 digits)', () => {
    expect(validateDic('CZ1234567890')).toBe(true);
  });

  it('rejects without CZ prefix', () => {
    expect(validateDic('12345678')).toBe(false);
  });

  it('rejects too short', () => {
    expect(validateDic('CZ1234567')).toBe(false);
  });

  it('rejects with letters after CZ', () => {
    expect(validateDic('CZ1234567A')).toBe(false);
  });
});

describe('isEuCountry', () => {
  it('CZ is EU', () => expect(isEuCountry('CZ')).toBe(true));
  it('DE is EU', () => expect(isEuCountry('DE')).toBe(true));
  it('SK is EU', () => expect(isEuCountry('SK')).toBe(true));
  it('US is not EU', () => expect(isEuCountry('US')).toBe(false));
  it('GB is not EU', () => expect(isEuCountry('GB')).toBe(false));
});

describe('constants', () => {
  it('basis point rates match percent rates', () => {
    expect(CZ_VAT_RATES_BP.standard).toBe(CZ_VAT_RATES_PERCENT.standard * 100);
    expect(CZ_VAT_RATES_BP.reduced).toBe(CZ_VAT_RATES_PERCENT.reduced * 100);
    expect(CZ_VAT_RATES_BP.zero).toBe(CZ_VAT_RATES_PERCENT.zero * 100);
  });
});
