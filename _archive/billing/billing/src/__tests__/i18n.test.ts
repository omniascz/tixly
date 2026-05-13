/**
 * i18n tests — date formatting, amount formatting, label coverage.
 */
import { describe, it, expect } from 'vitest';
import { formatDate, formatAmountHalire, getLabels } from '../lib/i18n.js';

describe('formatDate', () => {
  it('cs: strips leading zeros', () => {
    expect(formatDate('2026-01-05', 'cs')).toBe('5.1.2026');
  });

  it('sk: strips leading zeros', () => {
    expect(formatDate('2026-12-31', 'sk')).toBe('31.12.2026');
  });

  it('de: keeps leading zeros', () => {
    expect(formatDate('2026-01-05', 'de')).toBe('05.01.2026');
  });

  it('en: MM/DD/YYYY format', () => {
    expect(formatDate('2026-01-05', 'en')).toBe('01/05/2026');
  });

  it('returns original for non-ISO input', () => {
    expect(formatDate('not a date', 'cs')).toBe('not a date');
  });
});

describe('formatAmountHalire', () => {
  it('formats CZK with Kč suffix', () => {
    expect(formatAmountHalire(1234567, 'CZK')).toBe('12\u00A0345,67\u00A0Kč');
  });

  it('formats EUR with € suffix', () => {
    expect(formatAmountHalire(1234567, 'EUR')).toBe('12\u00A0345,67\u00A0€');
  });

  it('formats small amounts', () => {
    expect(formatAmountHalire(1, 'CZK')).toBe('0,01\u00A0Kč');
  });

  it('formats zero', () => {
    expect(formatAmountHalire(0, 'CZK')).toBe('0,00\u00A0Kč');
  });

  it('formats round amounts', () => {
    expect(formatAmountHalire(10000, 'CZK')).toBe('100,00\u00A0Kč');
  });

  it('defaults to CZK', () => {
    const result = formatAmountHalire(5000);
    expect(result).toContain('Kč');
  });
});

describe('getLabels', () => {
  it('returns cs labels', () => {
    const labels = getLabels('cs');
    expect(labels.invoice).toBe('FAKTURA');
    expect(labels.creditNote).toBe('DOBROPIS');
    expect(labels.platformFees).toBe('Poplatky platformy');
  });

  it('returns en labels', () => {
    const labels = getLabels('en');
    expect(labels.invoice).toBe('INVOICE');
    expect(labels.creditNote).toBe('CREDIT NOTE');
  });

  it('returns de labels', () => {
    const labels = getLabels('de');
    expect(labels.invoice).toBe('RECHNUNG');
    expect(labels.totalLabel).toBe('GESAMTBETRAG');
  });

  it('returns sk labels', () => {
    const labels = getLabels('sk');
    expect(labels.invoice).toBe('FAKTÚRA');
    expect(labels.supplier).toBe('DODÁVATEĽ');
  });

  it('all locales have same keys', () => {
    const csKeys = Object.keys(getLabels('cs')).sort();
    const enKeys = Object.keys(getLabels('en')).sort();
    const deKeys = Object.keys(getLabels('de')).sort();
    const skKeys = Object.keys(getLabels('sk')).sort();
    expect(csKeys).toEqual(enKeys);
    expect(csKeys).toEqual(deKeys);
    expect(csKeys).toEqual(skKeys);
  });
});
