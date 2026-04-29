import { describe, it, expect } from 'vitest';
import { formatWidgetPrice } from '../src/lib/format';

describe('formatWidgetPrice', () => {
  it('formátuje CZK v češtině', () => {
    const result = formatWidgetPrice(89900, 'CZK', 'cs');
    expect(result).toContain('899');
    expect(result).toContain('Kč');
  });

  it('formátuje EUR v angličtině', () => {
    const result = formatWidgetPrice(1999, 'EUR', 'en');
    expect(result).toContain('19.99');
  });

  it('formátuje JPY bez desetinných míst', () => {
    const result = formatWidgetPrice(5000, 'JPY', 'ja');
    expect(result).toContain('5,000');
    expect(result).not.toContain('.');
  });

  it('formátuje 0 Kč', () => {
    const result = formatWidgetPrice(0, 'CZK', 'cs');
    expect(result).toContain('0');
  });

  it('formátuje haléře správně (550 = 5,50 Kč)', () => {
    const result = formatWidgetPrice(550, 'CZK', 'cs');
    expect(result).toContain('5');
    expect(result).toContain('50');
  });

  it('formátuje velkou částku (249900 = 2499 Kč)', () => {
    const result = formatWidgetPrice(249900, 'CZK', 'cs');
    expect(result).toContain('2');
    expect(result).toContain('499');
  });
});
