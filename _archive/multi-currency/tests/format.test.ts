import { describe, expect, it } from 'vitest';
import {
  formatPrice,
  getSubunitMultiplier,
  getCurrencySymbol,
  getCurrencyDecimals,
  toSubunits,
  toMajorUnits,
} from '../src/lib/format';

describe('formatPrice', () => {
  it('formatuje CZK spravne', () => {
    const result = formatPrice(15050, 'CZK');
    // cs-CZ locale: "150,50 Kc" (presny format zavisi na ICU)
    expect(result).toContain('150');
    expect(result).toContain('50');
  });

  it('formatuje EUR spravne', () => {
    const result = formatPrice(1250, 'EUR');
    expect(result).toContain('12');
    expect(result).toContain('50');
  });

  it('formatuje JPY bez desetinnych mist', () => {
    const result = formatPrice(1000, 'JPY');
    // JPY nema subunity, 1000 subunitu = 1000 JPY
    expect(result).toContain('1');
    // Nesmí obsahovat decimální tečku/čárku s nenulovými místy
    expect(result).not.toMatch(/[.,]\d{1,2}[^0-9]/);
  });

  it('formatuje 0 spravne', () => {
    const result = formatPrice(0, 'CZK');
    expect(result).toContain('0');
  });

  it('haze chybu pro neinteger', () => {
    expect(() => formatPrice(150.5, 'CZK')).toThrow('must be an integer');
  });

  it('haze chybu pro zapornou hodnotu', () => {
    expect(() => formatPrice(-100, 'CZK')).toThrow('must be non-negative');
  });

  it('formatuje USD s dolarem', () => {
    const result = formatPrice(9999, 'USD');
    expect(result).toContain('99');
    expect(result).toContain('99');
  });

  it('formatuje PLN', () => {
    const result = formatPrice(5000, 'PLN');
    expect(result).toContain('50');
  });
});

describe('getSubunitMultiplier', () => {
  it('CZK = 100', () => expect(getSubunitMultiplier('CZK')).toBe(100));
  it('EUR = 100', () => expect(getSubunitMultiplier('EUR')).toBe(100));
  it('JPY = 1', () => expect(getSubunitMultiplier('JPY')).toBe(1));
  it('unknown = 100 (default)', () => expect(getSubunitMultiplier('XYZ')).toBe(100));
});

describe('getCurrencySymbol', () => {
  it('CZK = Kc', () => expect(getCurrencySymbol('CZK')).toBe('Kč'));
  it('EUR = €', () => expect(getCurrencySymbol('EUR')).toBe('€'));
  it('USD = $', () => expect(getCurrencySymbol('USD')).toBe('$'));
  it('PLN = zl', () => expect(getCurrencySymbol('PLN')).toBe('zł'));
  it('unknown vraci kod', () => expect(getCurrencySymbol('XYZ')).toBe('XYZ'));
});

describe('getCurrencyDecimals', () => {
  it('CZK = 2', () => expect(getCurrencyDecimals('CZK')).toBe(2));
  it('JPY = 0', () => expect(getCurrencyDecimals('JPY')).toBe(0));
  it('EUR = 2', () => expect(getCurrencyDecimals('EUR')).toBe(2));
});

describe('toSubunits', () => {
  it('CZK: 150.50 → 15050', () => expect(toSubunits(150.50, 'CZK')).toBe(15050));
  it('EUR: 12.99 → 1299', () => expect(toSubunits(12.99, 'EUR')).toBe(1299));
  it('JPY: 1000 → 1000', () => expect(toSubunits(1000, 'JPY')).toBe(1000));
  it('zaokrouhluje spravne', () => expect(toSubunits(0.015, 'CZK')).toBe(2)); // banker's rounding
  it('0 → 0', () => expect(toSubunits(0, 'CZK')).toBe(0));
});

describe('toMajorUnits', () => {
  it('CZK: 15050 → 150.50', () => expect(toMajorUnits(15050, 'CZK')).toBe(150.50));
  it('EUR: 1299 → 12.99', () => expect(toMajorUnits(1299, 'EUR')).toBe(12.99));
  it('JPY: 1000 → 1000', () => expect(toMajorUnits(1000, 'JPY')).toBe(1000));
  it('0 → 0', () => expect(toMajorUnits(0, 'CZK')).toBe(0));
});
