import { describe, it, expect } from 'vitest';
import { getVatRate, splitGrossToNetVat, resolveVatRate } from '../vat-rates';

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
