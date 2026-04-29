/**
 * QR Payment tests — SPD*1.0 format, IBAN validation, symbol validators.
 */
import { describe, it, expect } from 'vitest';
import {
  validateCzechIban,
  validateVariableSymbol,
  validateSpecificSymbol,
  validateConstantSymbol,
  validateQrPaymentData,
  generateQrPaymentData,
} from '../lib/qr-payment.js';

describe('validateCzechIban', () => {
  it('accepts valid CZ IBAN', () => {
    // CZ65 0800 0000 1920 0014 5399 — well-known test IBAN
    const result = validateCzechIban('CZ6508000000192000145399');
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('rejects non-CZ prefix', () => {
    const result = validateCzechIban('DE6508000000192000145399');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('IBAN must start with CZ');
  });

  it('rejects wrong length', () => {
    const result = validateCzechIban('CZ650800000019200014');
    expect(result.valid).toBe(false);
  });

  it('rejects non-digit characters after CZ', () => {
    const result = validateCzechIban('CZ65ABCD000019200014XX');
    expect(result.valid).toBe(false);
  });

  it('rejects invalid checksum', () => {
    const result = validateCzechIban('CZ0008000000192000145399');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('IBAN checksum validation failed');
  });
});

describe('validateVariableSymbol', () => {
  it('accepts 1-10 digits', () => {
    expect(validateVariableSymbol('1')).toBe(true);
    expect(validateVariableSymbol('1234567890')).toBe(true);
  });

  it('rejects empty', () => {
    expect(validateVariableSymbol('')).toBe(false);
  });

  it('rejects over 10 digits', () => {
    expect(validateVariableSymbol('12345678901')).toBe(false);
  });

  it('rejects non-digits', () => {
    expect(validateVariableSymbol('123abc')).toBe(false);
  });
});

describe('validateSpecificSymbol', () => {
  it('accepts 1-10 digits', () => {
    expect(validateSpecificSymbol('999')).toBe(true);
  });

  it('rejects empty', () => {
    expect(validateSpecificSymbol('')).toBe(false);
  });
});

describe('validateConstantSymbol', () => {
  it('accepts 1-4 digits', () => {
    expect(validateConstantSymbol('0308')).toBe(true);
    expect(validateConstantSymbol('1')).toBe(true);
  });

  it('rejects over 4 digits', () => {
    expect(validateConstantSymbol('12345')).toBe(false);
  });
});

describe('validateQrPaymentData', () => {
  const validData = {
    iban: 'CZ6508000000192000145399',
    amountHalire: 123450,
    currency: 'CZK',
  };

  it('valid data passes', () => {
    const result = validateQrPaymentData(validData);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects zero amount', () => {
    const result = validateQrPaymentData({ ...validData, amountHalire: 0 });
    expect(result.valid).toBe(false);
  });

  it('rejects negative amount', () => {
    const result = validateQrPaymentData({ ...validData, amountHalire: -100 });
    expect(result.valid).toBe(false);
  });

  it('rejects non-integer amount', () => {
    const result = validateQrPaymentData({ ...validData, amountHalire: 100.5 });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid IBAN', () => {
    const result = validateQrPaymentData({ ...validData, iban: 'INVALID' });
    expect(result.valid).toBe(false);
  });
});

describe('generateQrPaymentData', () => {
  it('generates valid SPD*1.0 string', () => {
    const data = generateQrPaymentData({
      iban: 'CZ6508000000192000145399',
      amountHalire: 123450, // 1234.50 CZK
    });
    expect(data).toContain('SPD*1.0');
    expect(data).toContain('ACC:CZ6508000000192000145399');
    expect(data).toContain('AM:1234.50');
    expect(data).toContain('CC:CZK');
  });

  it('includes variable symbol', () => {
    const data = generateQrPaymentData({
      iban: 'CZ6508000000192000145399',
      amountHalire: 10000,
      variableSymbol: '2026001',
    });
    expect(data).toContain('X-VS:2026001');
  });

  it('includes note and due date', () => {
    const data = generateQrPaymentData({
      iban: 'CZ6508000000192000145399',
      amountHalire: 10000,
      note: 'Faktura 123',
      dueDate: '2026-05-01',
    });
    expect(data).toContain('MSG:Faktura 123');
    expect(data).toContain('DT:2026-05-01');
  });

  it('includes recipient name', () => {
    const data = generateQrPaymentData({
      iban: 'CZ6508000000192000145399',
      amountHalire: 10000,
      recipientName: 'Test s.r.o.',
    });
    expect(data).toContain('RN:Test s.r.o.');
  });

  it('converts haléře to CZK with 2 decimals', () => {
    const data = generateQrPaymentData({
      iban: 'CZ6508000000192000145399',
      amountHalire: 1, // 0.01 CZK
    });
    expect(data).toContain('AM:0.01');
  });

  it('handles large amounts', () => {
    const data = generateQrPaymentData({
      iban: 'CZ6508000000192000145399',
      amountHalire: 9999999, // 99999.99 CZK
    });
    expect(data).toContain('AM:99999.99');
  });
});
