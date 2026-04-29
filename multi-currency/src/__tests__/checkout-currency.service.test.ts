import { describe, it, expect, vi } from 'vitest';
import {
  getCheckoutPrice,
  lockOrderCurrency,
  getOrderCurrency,
  getSupportedCurrencies,
  formatCurrencyDisplay,
} from '../services/checkout-currency.service.js';
import type { DbAdapter } from '../services/checkout-currency.service.js';

// ---------------------------------------------------------------------------
// Mock currency.service to avoid DB in unit tests
// ---------------------------------------------------------------------------

vi.mock('../services/currency.service.js', () => ({
  convertCurrency: vi.fn().mockResolvedValue({
    amountSubunits: 50000,  // CZK
    from: 'CZK',
    to: 'EUR',
    rate: '0.03970000',
    resultSubunits: 1985,  // ~19.85 EUR
    date: '2026-04-14',
  }),
  getLatestRate: vi.fn().mockResolvedValue({
    rate: 25.18,
    date: '2026-04-14',
    source: 'CNB',
  }),
}));

function makeOrderCurrencyRow(overrides: Record<string, unknown> = {}) {
  return {
    order_id: 'order-001',
    base_currency: 'CZK',
    base_amount_hellers: 50000,
    target_currency: 'EUR',
    target_amount_subunits: 1985,
    exchange_rate: '0.03970000',
    rate_date: '2026-04-14',
    rate_locked_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
  };
}

describe('getCheckoutPrice', () => {
  it('převede CZK na EUR pro checkout', async () => {
    const db = makeDb();

    const result = await getCheckoutPrice(50000, 'CZK', 'EUR', db);

    expect(result.baseCurrency).toBe('CZK');
    expect(result.targetCurrency).toBe('EUR');
    expect(result.targetAmountSubunits).toBe(1985);
    expect(result.exchangeRate).toBe('0.03970000');
    expect(result.rateSource).toBe('CNB');
  });

  it('vrátí stejnou částku pro stejnou měnu (identity)', async () => {
    const db = makeDb();

    const result = await getCheckoutPrice(50000, 'CZK', 'CZK', db);

    expect(result.targetAmountSubunits).toBe(50000);
    expect(result.exchangeRate).toBe('1.00000000');
    expect(result.rateSource).toBe('IDENTITY');
  });

  it('vyhodí VALIDATION_ERROR pro nepodporovanou měnu', async () => {
    const db = makeDb();

    await expect(getCheckoutPrice(50000, 'CZK', 'XYZ', db)).rejects.toThrow('VALIDATION_ERROR');
  });

  it('vyhodí VALIDATION_ERROR pro nulovou částku', async () => {
    const db = makeDb();

    await expect(getCheckoutPrice(0, 'CZK', 'EUR', db)).rejects.toThrow('VALIDATION_ERROR');
  });

  it('vyhodí RATE_NOT_FOUND pokud kurz není k dispozici', async () => {
    const { getLatestRate } = await import('../services/currency.service.js');
    vi.mocked(getLatestRate).mockResolvedValueOnce(null);

    const db = makeDb();

    await expect(getCheckoutPrice(50000, 'CZK', 'EUR', db)).rejects.toThrow('RATE_NOT_FOUND');
  });
});

describe('lockOrderCurrency', () => {
  it('uzamkne kurz pro objednávku', async () => {
    const db = makeDb([[makeOrderCurrencyRow()]]);

    const result = await lockOrderCurrency(
      'order-001',
      {
        baseCurrency: 'CZK',
        baseAmountHellers: 50000,
        targetCurrency: 'EUR',
        targetAmountSubunits: 1985,
        exchangeRate: '0.03970000',
        rateDate: '2026-04-14',
        rateSource: 'CNB',
      },
      db,
    );

    expect(result.orderId).toBe('order-001');
    expect(result.targetCurrency).toBe('EUR');
    expect(result.exchangeRate).toBe('0.03970000');
  });
});

describe('getOrderCurrency', () => {
  it('vrátí uzamčený kurz pro objednávku', async () => {
    const db = makeDb([[makeOrderCurrencyRow()]]);

    const result = await getOrderCurrency('order-001', db);

    expect(result).not.toBeNull();
    expect(result?.targetCurrency).toBe('EUR');
    expect(result?.rateLockedAt).toBe('2026-04-14T10:00:00Z');
  });

  it('vrátí null pokud kurz není uzamčen', async () => {
    const db = makeDb([[]]);

    const result = await getOrderCurrency('order-001', db);

    expect(result).toBeNull();
  });
});

describe('getSupportedCurrencies', () => {
  it('vrátí seznam podporovaných měn', () => {
    const currencies = getSupportedCurrencies();

    expect(currencies).toContain('CZK');
    expect(currencies).toContain('EUR');
    expect(currencies).toContain('USD');
    expect(currencies).toContain('GBP');
    expect(currencies).toContain('PLN');
  });
});

describe('formatCurrencyDisplay', () => {
  it('formátuje CZK částku pro zobrazení', () => {
    const formatted = formatCurrencyDisplay(50000, 'CZK');
    // Should contain 500 (500.00 CZK)
    expect(formatted).toContain('500');
  });

  it('formátuje EUR částku pro zobrazení', () => {
    const formatted = formatCurrencyDisplay(1985, 'EUR');
    // 19.85 EUR
    expect(formatted).toContain('19');
  });
});
