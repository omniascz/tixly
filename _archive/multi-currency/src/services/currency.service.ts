/**
 * Currency Service pro Tixly.
 * Adaptovano z @acc/accounting currency engine.
 *
 * Hlavni rozdil oproti accounting verzi:
 * - Pouziva DbAdapter misto Drizzle ORM (konzistence s ostatnimi Tixly moduly)
 * - Pracuje s integer subunity (halere/centy) misto Decimal
 * - Nepotrebuje revaluation (kurzove rozdily) — to je ucetni koncept
 */

import type { DbAdapter } from '@tixly/db-adapter';
import type {
  Currency,
  ExchangeRateInput,
  CurrencyConversion,
} from '../types/currency.js';
import { CURRENCY_SUBUNITS } from '../types/currency.js';

export interface CurrencyServiceDeps {
  db: DbAdapter;
}

/**
 * Ulozi kurzy do platform.exchange_rates.
 * Upsert na (rate_date, base, quote, source).
 */
export async function storeExchangeRates(
  deps: CurrencyServiceDeps,
  rates: ExchangeRateInput[],
): Promise<number> {
  if (rates.length === 0) return 0;

  let stored = 0;

  for (const r of rates) {
    await deps.db.execute(
      `INSERT INTO platform.exchange_rates (rate_date, base, quote, rate, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (rate_date, base, quote, source)
       DO UPDATE SET rate = EXCLUDED.rate`,
      [r.date, r.base, r.quote, r.rate, r.source],
    );
    stored++;
  }

  return stored;
}

/**
 * Ziska konverzni faktor pro prevod z `from` do `to`.
 * Vraci M takove, ze: amount_from * M = amount_to (v hlavnich jednotkach).
 *
 * DB konvence (CNB): base=CZK, quote=EUR, rate=25.21
 * Znamena: 1 EUR = 25.21 CZK, tj. rate = kolik [base] za 1 [quote].
 *
 * Primy match (base=from, quote=to): rate vyjadruje [from] za 1 [to]
 *   → konverzni faktor from→to = 1/rate
 *
 * Inverzni match (base=to, quote=from): rate vyjadruje [to] za 1 [from]
 *   → konverzni faktor from→to = rate
 *
 * Pokud presny datum neexistuje, pouzije nejblizsi predchozi.
 *
 * @returns konverzni faktor (napr. 0.0397 pro CZK→EUR, 25.21 pro EUR→CZK)
 * @throws Error pokud kurz nenalezen
 */
export async function getRate(
  deps: CurrencyServiceDeps,
  from: string,
  to: string,
  date: string,
  source?: string,
): Promise<number> {
  if (from === to) return 1;

  const sourceCondition = source ? ' AND source = $4' : '';
  const params: unknown[] = [from, to, date];
  if (source) params.push(source);

  // Primy match: base=from, quote=to
  // rate = kolik [from] za 1 [to] → konverzni faktor = 1/rate
  const rows = await deps.db.query<{ rate: string }>(
    `SELECT rate FROM platform.exchange_rates
     WHERE base = $1 AND quote = $2 AND rate_date <= $3${sourceCondition}
     ORDER BY rate_date DESC
     LIMIT 1`,
    params,
  );

  if (rows.length > 0) {
    return 1 / Number(rows[0]!.rate);
  }

  // Inverzni match: base=to, quote=from
  // rate = kolik [to] za 1 [from] → konverzni faktor = rate
  const inverseParams: unknown[] = [to, from, date];
  if (source) inverseParams.push(source);

  const inverseRows = await deps.db.query<{ rate: string }>(
    `SELECT rate FROM platform.exchange_rates
     WHERE base = $1 AND quote = $2 AND rate_date <= $3${sourceCondition}
     ORDER BY rate_date DESC
     LIMIT 1`,
    inverseParams,
  );

  if (inverseRows.length > 0) {
    return Number(inverseRows[0]!.rate);
  }

  throw new Error(
    `Exchange rate not found: ${from}/${to} on ${date}${source ? ` (source: ${source})` : ''}`,
  );
}

/**
 * Konvertuje castku z jedne meny do druhe.
 * Vstup i vystup je v subunitech (halere, centy, ...).
 *
 * @param amountSubunits Castka ve zdrojove mene (integer subunity)
 * @param from           ISO 4217 zdrojova mena
 * @param to             ISO 4217 cilova mena
 * @param date           Datum kurzu (YYYY-MM-DD)
 * @returns Konvertovana castka v subunitech cilove meny
 */
export async function convertCurrency(
  deps: CurrencyServiceDeps,
  amountSubunits: number,
  from: string,
  to: string,
  date: string,
  source?: string,
): Promise<CurrencyConversion> {
  if (from === to) {
    return {
      amountSubunits,
      from,
      to,
      rate: '1.00000000',
      resultSubunits: amountSubunits,
      date,
    };
  }

  const rate = await getRate(deps, from, to, date, source);

  // Prevod s ohledem na ruzne subunity (napr. CZK 100 subunitu vs JPY 1)
  const fromSubunit = CURRENCY_SUBUNITS[from] ?? 100;
  const toSubunit = CURRENCY_SUBUNITS[to] ?? 100;

  // amountSubunits -> hlavni jednotky -> * rate -> subunity cilove meny
  const majorUnits = amountSubunits / fromSubunit;
  const convertedMajor = majorUnits * rate;
  const resultSubunits = Math.round(convertedMajor * toSubunit);

  return {
    amountSubunits,
    from,
    to,
    rate: rate.toFixed(8),
    resultSubunits,
    date,
  };
}

/**
 * Vrati seznam aktivnich men.
 */
export async function listCurrencies(
  deps: CurrencyServiceDeps,
): Promise<Currency[]> {
  return deps.db.query<Currency>(
    `SELECT code, name, symbol, decimals, subunit, is_active
     FROM platform.currencies
     WHERE is_active = true
     ORDER BY code`,
  );
}

/**
 * Vrati detail meny podle kodu.
 */
export async function getCurrency(
  deps: CurrencyServiceDeps,
  code: string,
): Promise<Currency | null> {
  const rows = await deps.db.query<Currency>(
    `SELECT code, name, symbol, decimals, subunit, is_active
     FROM platform.currencies
     WHERE code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

/**
 * Vrati posledni dostupny kurz pro menovy par.
 * Uzitecne pro zobrazeni "aktualni kurz" v UI.
 */
export async function getLatestRate(
  deps: CurrencyServiceDeps,
  base: string,
  quote: string,
): Promise<{ rate: number; date: string; source: string } | null> {
  if (base === quote) {
    return { rate: 1, date: new Date().toISOString().slice(0, 10), source: 'IDENTITY' };
  }

  const rows = await deps.db.query<{ rate: string; rate_date: string; source: string }>(
    `SELECT rate, rate_date, source FROM platform.exchange_rates
     WHERE base = $1 AND quote = $2
     ORDER BY rate_date DESC
     LIMIT 1`,
    [base, quote],
  );

  if (rows.length === 0) return null;

  return {
    rate: Number(rows[0]!.rate),
    date: rows[0]!.rate_date,
    source: rows[0]!.source,
  };
}
