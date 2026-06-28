import { describe, it, expect } from 'vitest';
import { getVatRate, splitGrossToNetVat, resolveVatRate, resolveEffectiveVatRate } from '../vat-rates';
import { isReverseChargeApplicable, getCountryCodeFromVat } from '../vies';
import { checkThresholdStatus, VAT_REGISTRATION_THRESHOLDS } from '../vat-thresholds';

describe('getVatRate', () => {
  it('CZ cultural = 10 %', () => {
    expect(getVatRate('CZ', 'cultural')).toBe(10);
  });

  it('SR cultural = 5 % (NE 10 jako CZ)', () => {
    expect(getVatRate('SR', 'cultural')).toBe(5);
  });

  it('CZ standard = 21 %', () => {
    expect(getVatRate('CZ', 'standard')).toBe(21);
  });

  it('SR standard = 23 %', () => {
    expect(getVatRate('SR', 'standard')).toBe(23);
  });

  it('CZ food_beverage = 12 %', () => {
    expect(getVatRate('CZ', 'food_beverage')).toBe(12);
  });

  it('SR food_beverage = 19 %', () => {
    expect(getVatRate('SR', 'food_beverage')).toBe(19);
  });

  it('DE cultural = 7 %', () => {
    expect(getVatRate('DE', 'cultural')).toBe(7);
  });

  it('AT cultural = 13 %', () => {
    expect(getVatRate('AT', 'cultural')).toBe(13);
  });

  it('PL cultural = 8 %', () => {
    expect(getVatRate('PL', 'cultural')).toBe(8);
  });

  it('UK cultural = 20 % (UK: standard rate applies to events)', () => {
    expect(getVatRate('UK', 'cultural')).toBe(20);
  });

  it('FR cultural = 5 %', () => {
    expect(getVatRate('FR', 'cultural')).toBe(5);
  });
});

describe('splitGrossToNetVat', () => {
  it('splituje 12100 halířů @ 21 % na 10000 + 2100', () => {
    expect(splitGrossToNetVat(12100, 21)).toEqual({ netHalire: 10000, vatHalire: 2100 });
  });

  it('splituje 11000 halířů @ 10 % na 10000 + 1000', () => {
    expect(splitGrossToNetVat(11000, 10)).toEqual({ netHalire: 10000, vatHalire: 1000 });
  });

  it('splituje 10500 halířů @ 5 % SR cultural na 10000 + 500', () => {
    expect(splitGrossToNetVat(10500, 5)).toEqual({ netHalire: 10000, vatHalire: 500 });
  });

  it('0 % → vše na net', () => {
    expect(splitGrossToNetVat(10000, 0)).toEqual({ netHalire: 10000, vatHalire: 0 });
  });
});

describe('resolveVatRate', () => {
  it('CZ promotér + cultural akce = 10 %', () => {
    expect(resolveVatRate({ country: 'CZ', vatCategory: 'cultural' })).toBe(10);
  });

  it('SR promotér + cultural akce = 5 % (key launch feature!)', () => {
    expect(resolveVatRate({ country: 'SR', vatCategory: 'cultural' })).toBe(5);
  });

  it('NULL country fallback na CZ', () => {
    expect(resolveVatRate({ country: null, vatCategory: 'standard' })).toBe(21);
  });

  it('NULL category fallback na cultural', () => {
    expect(resolveVatRate({ country: 'CZ', vatCategory: null })).toBe(10);
  });

  it('neznámá category fallback na cultural', () => {
    expect(resolveVatRate({ country: 'CZ', vatCategory: 'bullshit' })).toBe(10);
  });
});

describe('resolveEffectiveVatRate — reverse charge', () => {
  it('CZ seller + CZ buyer = standard 10 % cultural (no RC)', () => {
    const r = resolveEffectiveVatRate({ sellerCountry: 'CZ', vatCategory: 'cultural', buyerVatCountry: 'CZ' });
    expect(r.vatRatePct).toBe(10);
    expect(r.isReverseCharge).toBe(false);
  });

  it('CZ seller + DE buyer = 0 % reverse charge', () => {
    const r = resolveEffectiveVatRate({ sellerCountry: 'CZ', vatCategory: 'cultural', buyerVatCountry: 'DE' });
    expect(r.vatRatePct).toBe(0);
    expect(r.isReverseCharge).toBe(true);
    expect(r.reverseChargeNote).toContain('Article 44');
  });

  it('SK seller + PL buyer = 0 % reverse charge', () => {
    const r = resolveEffectiveVatRate({ sellerCountry: 'SK', vatCategory: 'cultural', buyerVatCountry: 'PL' });
    expect(r.vatRatePct).toBe(0);
    expect(r.isReverseCharge).toBe(true);
  });

  it('no buyerVatCountry = standard rate', () => {
    const r = resolveEffectiveVatRate({ sellerCountry: 'CZ', vatCategory: 'cultural' });
    expect(r.vatRatePct).toBe(10);
    expect(r.isReverseCharge).toBe(false);
  });

  it('UK buyer (non-EU) from CZ seller = no reverse charge', () => {
    const r = resolveEffectiveVatRate({ sellerCountry: 'CZ', vatCategory: 'cultural', buyerVatCountry: 'GB' });
    expect(r.isReverseCharge).toBe(false);
    expect(r.vatRatePct).toBe(10);
  });
});

describe('VIES — isReverseChargeApplicable', () => {
  it('DE buyer, CZ seller → true', () => {
    expect(isReverseChargeApplicable('DE', 'CZ')).toBe(true);
  });

  it('CZ buyer, CZ seller → false (same country)', () => {
    expect(isReverseChargeApplicable('CZ', 'CZ')).toBe(false);
  });

  it('GB buyer, CZ seller → false (UK not EU)', () => {
    expect(isReverseChargeApplicable('GB', 'CZ')).toBe(false);
  });
});

describe('VIES — getCountryCodeFromVat', () => {
  it('DE123456789 → DE', () => {
    expect(getCountryCodeFromVat('DE123456789')).toBe('DE');
  });

  it('CZ12345678 → CZ', () => {
    expect(getCountryCodeFromVat('CZ12345678')).toBe('CZ');
  });

  it('lowercase de123 → DE', () => {
    expect(getCountryCodeFromVat('de123456789')).toBe('DE');
  });

  it('invalid → null', () => {
    expect(getCountryCodeFromVat('XX')).toBeNull();
  });
});

describe('VAT threshold exemptions', () => {
  it('CZ threshold = 2 000 000 CZK', () => {
    expect(VAT_REGISTRATION_THRESHOLDS['CZ'].annualThreshold).toBe(2_000_000);
  });

  it('DE threshold = 22 000 EUR', () => {
    expect(VAT_REGISTRATION_THRESHOLDS['DE'].annualThreshold).toBe(22_000);
  });

  it('checkThresholdStatus: below threshold = isExempt', () => {
    const status = checkThresholdStatus('CZ', 100_000_00, false); // 100k CZK in haléře
    expect(status.isExempt).toBe(true);
    expect(status.shouldRegister).toBe(false);
    expect(status.warningPct).toBeLessThan(100);
  });

  it('checkThresholdStatus: over threshold = shouldRegister', () => {
    const status = checkThresholdStatus('CZ', 250_000_000, false); // 2.5M CZK in haléře
    expect(status.isExempt).toBe(false);
    expect(status.shouldRegister).toBe(true);
    expect(status.warningPct).toBe(100);
  });

  it('checkThresholdStatus: already vat_payer = shouldRegister=false', () => {
    const status = checkThresholdStatus('CZ', 250_000_000, true);
    expect(status.shouldRegister).toBe(false);
    expect(status.isExempt).toBe(false);
  });
});
