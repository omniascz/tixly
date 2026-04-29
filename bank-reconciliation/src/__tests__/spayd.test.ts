import { describe, it, expect } from 'vitest';
import {
  buildSpaydString,
  formatAmountForSpayd,
  generateSpaydQr,
  type SpaydConfig,
} from '../lib/spayd-generator.js';
import { BankReconciliationError } from '../lib/bank-errors.js';

const goodConfig: SpaydConfig = {
  iban: 'CZ1234567890123456789012',
  bic: 'FIOBCZPP',
  studioName: 'Studio Test',
  isConfigured: true,
};

describe('formatAmountForSpayd', () => {
  it('converts 49000 halíře to "490.00"', () => {
    expect(formatAmountForSpayd(49000)).toBe('490.00');
  });

  it('converts 150 halíře to "1.50"', () => {
    expect(formatAmountForSpayd(150)).toBe('1.50');
  });

  it('converts 0 to "0.00"', () => {
    expect(formatAmountForSpayd(0)).toBe('0.00');
  });

  it('throws on negative', () => {
    expect(() => formatAmountForSpayd(-1)).toThrow(BankReconciliationError);
  });
});

describe('buildSpaydString', () => {
  it('produces correct SPAYD format', () => {
    const s = buildSpaydString(goodConfig, {
      amountHalire: 150000,
      variableSymbol: '12345',
      message: 'Order 12345',
    });
    expect(s).toContain('SPD*1.0');
    expect(s).toContain('ACC:CZ1234567890123456789012+FIOBCZPP');
    expect(s).toContain('AM:1500.00');
    expect(s).toContain('CC:CZK');
    expect(s).toContain('X-VS:12345');
    expect(s).toContain('MSG:Order 12345');
  });

  it('rejects invalid VS (letters)', () => {
    expect(() =>
      buildSpaydString(goodConfig, { amountHalire: 100, variableSymbol: 'abc' }),
    ).toThrow(BankReconciliationError);
  });

  it('rejects VS longer than 10 digits', () => {
    expect(() =>
      buildSpaydString(goodConfig, { amountHalire: 100, variableSymbol: '12345678901' }),
    ).toThrow(BankReconciliationError);
  });

  it('rejects bad IBAN format', () => {
    const bad: SpaydConfig = { ...goodConfig, iban: 'XX12345' };
    expect(() =>
      buildSpaydString(bad, { amountHalire: 100, variableSymbol: '1' }),
    ).toThrow(BankReconciliationError);
  });

  it('throws IBAN_NOT_CONFIGURED when config not configured', () => {
    const unconfigured: SpaydConfig = { ...goodConfig, isConfigured: false };
    expect(() =>
      buildSpaydString(unconfigured, { amountHalire: 100, variableSymbol: '1' }),
    ).toThrow(BankReconciliationError);
  });

  it('accepts non-CZ IBAN', () => {
    const sk: SpaydConfig = {
      ...goodConfig,
      iban: 'SK3112000000198742637541',
    };
    const s = buildSpaydString(sk, { amountHalire: 100, variableSymbol: '1' });
    expect(s).toContain('ACC:SK3112000000198742637541+FIOBCZPP');
  });
});

describe('generateSpaydQr', () => {
  it('returns a PNG data URL', async () => {
    const result = await generateSpaydQr(goodConfig, {
      amountHalire: 49000,
      variableSymbol: '2026001',
    });
    expect(result.spayd).toContain('SPD*1.0');
    expect(result.qrPngDataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
