import { describe, expect, it, vi } from 'vitest';
import type { DbAdapter } from '@tixly/db-adapter';
import {
  storeExchangeRates,
  getRate,
  convertCurrency,
  listCurrencies,
  getCurrency,
  getLatestRate,
} from '../src/services/currency.service';
import type { ExchangeRateInput } from '../src/types/currency';

function createMockDb(): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation((fn) => fn(createMockDb())),
  };
}

// ========================================================
// storeExchangeRates
// ========================================================
describe('storeExchangeRates', () => {
  it('vraci 0 pro prazdny seznam', async () => {
    const db = createMockDb();
    const count = await storeExchangeRates({ db }, []);
    expect(count).toBe(0);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('ulozi kurzy a vraci pocet', async () => {
    const db = createMockDb();
    const rates: ExchangeRateInput[] = [
      { date: '2026-04-12', base: 'CZK', quote: 'EUR', rate: '25.21000000', source: 'CNB' },
      { date: '2026-04-12', base: 'CZK', quote: 'USD', rate: '22.87500000', source: 'CNB' },
    ];
    const count = await storeExchangeRates({ db }, rates);
    expect(count).toBe(2);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('pouziva ON CONFLICT upsert', async () => {
    const db = createMockDb();
    await storeExchangeRates({ db }, [
      { date: '2026-04-12', base: 'CZK', quote: 'EUR', rate: '25.21', source: 'CNB' },
    ]);
    const sql = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO UPDATE');
  });
});

// ========================================================
// getRate
// ========================================================
//
// DB konvence (CNB): base=CZK, quote=EUR, rate=25.21
// Semantika: 1 [quote] = [rate] [base], tj. 1 EUR = 25.21 CZK
//
// getRate(from, to) vraci konverzni faktor M: amount_from * M = amount_to
//   Primy match (base=from, quote=to): M = 1/rate
//   Inverzni match (base=to, quote=from): M = rate
//
describe('getRate', () => {
  it('vraci 1 pro stejnou menu', async () => {
    const db = createMockDb();
    const rate = await getRate({ db }, 'CZK', 'CZK', '2026-04-12');
    expect(rate).toBe(1);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('vraci 1/rate pro primy match CZK->EUR', async () => {
    const db = createMockDb();
    // DB: base=CZK, quote=EUR, rate=25.21
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ rate: '25.21000000' }]);
    const rate = await getRate({ db }, 'CZK', 'EUR', '2026-04-12');
    // 1 CZK = 1/25.21 EUR
    expect(rate).toBeCloseTo(1 / 25.21, 4);
  });

  it('vraci rate primo pro inverzni match EUR->CZK', async () => {
    const db = createMockDb();
    // Primy par EUR/CZK neexistuje
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    // Inverzni: base=CZK, quote=EUR, rate=25.21
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ rate: '25.21000000' }]);

    const rate = await getRate({ db }, 'EUR', 'CZK', '2026-04-12');
    // 1 EUR = 25.21 CZK
    expect(rate).toBeCloseTo(25.21);
  });

  it('haze chybu kdyz kurz neexistuje', async () => {
    const db = createMockDb();
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await expect(
      getRate({ db }, 'CZK', 'BTC', '2026-04-12'),
    ).rejects.toThrow('Exchange rate not found');
  });

  it('filtruje podle source', async () => {
    const db = createMockDb();
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ rate: '25.21000000' }]);
    await getRate({ db }, 'CZK', 'EUR', '2026-04-12', 'CNB');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(sql).toContain('source = $4');
  });
});

// ========================================================
// convertCurrency
// ========================================================
describe('convertCurrency', () => {
  it('vraci stejnou castku pro stejnou menu', async () => {
    const db = createMockDb();
    const result = await convertCurrency({ db }, 15050, 'CZK', 'CZK', '2026-04-12');
    expect(result.resultSubunits).toBe(15050);
    expect(result.rate).toBe('1.00000000');
  });

  it('konvertuje CZK -> EUR spravne', async () => {
    const db = createMockDb();
    // DB: base=CZK, quote=EUR, rate=25.21
    // getRate(CZK, EUR) -> primy match -> 1/25.21
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ rate: '25.21000000' }]);

    // 2521 haleru = 25.21 CZK -> 25.21 * (1/25.21) = 1.00 EUR -> 100 centu
    const result = await convertCurrency({ db }, 2521, 'CZK', 'EUR', '2026-04-12');
    expect(result.resultSubunits).toBe(100);
    expect(result.from).toBe('CZK');
    expect(result.to).toBe('EUR');
  });

  it('konvertuje EUR -> CZK spravne', async () => {
    const db = createMockDb();
    // getRate(EUR, CZK): primy par neexistuje, inverzni match -> rate=25.21
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ rate: '25.21000000' }]);

    // 100 centu = 1 EUR -> 1 * 25.21 = 25.21 CZK -> 2521 haleru
    const result = await convertCurrency({ db }, 100, 'EUR', 'CZK', '2026-04-12');
    expect(result.resultSubunits).toBe(2521);
  });

  it('konvertuje s ruznymi subunity (JPY -> CZK)', async () => {
    const db = createMockDb();
    // DB: base=CZK, quote=JPY, rate=0.16841 (0.16841 CZK za 1 JPY)
    // getRate(JPY, CZK): primy par neexistuje
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    // Inverzni: base=CZK, quote=JPY, rate=0.16841 -> vraci 0.16841
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ rate: '0.16841000' }]);

    // 1000 JPY (subunit=1, takze 1000 major units)
    // majorUnits = 1000/1 = 1000 JPY
    // convertedMajor = 1000 * 0.16841 = 168.41 CZK
    // resultSubunits = round(168.41 * 100) = 16841 haleru
    const result = await convertCurrency({ db }, 1000, 'JPY', 'CZK', '2026-04-12');
    expect(result.resultSubunits).toBe(16841);
  });
});

// ========================================================
// listCurrencies
// ========================================================
describe('listCurrencies', () => {
  it('vraci seznam aktivnich men', async () => {
    const db = createMockDb();
    const mockCurrencies = [
      { code: 'CZK', name: 'Ceska koruna', symbol: 'Kc', decimals: 2, subunit: 100, is_active: true },
      { code: 'EUR', name: 'Euro', symbol: '\u20ac', decimals: 2, subunit: 100, is_active: true },
    ];
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockCurrencies);

    const result = await listCurrencies({ db });
    expect(result).toHaveLength(2);
    expect(result[0]!.code).toBe('CZK');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(sql).toContain('is_active = true');
  });
});

// ========================================================
// getCurrency
// ========================================================
describe('getCurrency', () => {
  it('vraci menu pokud existuje', async () => {
    const db = createMockDb();
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { code: 'EUR', name: 'Euro', symbol: '\u20ac', decimals: 2, subunit: 100, is_active: true },
    ]);
    const result = await getCurrency({ db }, 'EUR');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('EUR');
  });

  it('vraci null pokud neexistuje', async () => {
    const db = createMockDb();
    const result = await getCurrency({ db }, 'BTC');
    expect(result).toBeNull();
  });
});

// ========================================================
// getLatestRate
// ========================================================
describe('getLatestRate', () => {
  it('vraci 1 pro stejnou menu', async () => {
    const db = createMockDb();
    const result = await getLatestRate({ db }, 'CZK', 'CZK');
    expect(result).not.toBeNull();
    expect(result!.rate).toBe(1);
  });

  it('vraci null pokud kurz neexistuje', async () => {
    const db = createMockDb();
    const result = await getLatestRate({ db }, 'CZK', 'BTC');
    expect(result).toBeNull();
  });

  it('vraci posledni kurz', async () => {
    const db = createMockDb();
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { rate: '25.21000000', rate_date: '2026-04-12', source: 'CNB' },
    ]);
    const result = await getLatestRate({ db }, 'CZK', 'EUR');
    expect(result).not.toBeNull();
    expect(result!.rate).toBeCloseTo(25.21);
    expect(result!.date).toBe('2026-04-12');
  });
});
