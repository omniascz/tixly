/**
 * Multi-currency formatovaci utility.
 * Rozsiruje price-migration/price-utils.ts o podporu vice men.
 */

import { CURRENCY_SUBUNITS, CURRENCY_LOCALES, CURRENCY_SYMBOLS } from '../types/currency.js';

/**
 * Formatuje castku v subunitech na lidsky citelny string.
 * Pouziva spravny locale a symbol pro kazdou menu.
 *
 * @param subunits Castka v subunitech (halere, centy, ...)
 * @param currency ISO 4217 kod meny
 * @returns Formatovany string (napr. "150,50 Kc", "€12.50", "¥1,000")
 *
 * @example
 * formatPrice(15050, 'CZK')  // "150,50 Kc"
 * formatPrice(1250, 'EUR')   // "12,50 €"
 * formatPrice(1000, 'JPY')   // "¥1,000"  (JPY nema subunity)
 */
export function formatPrice(subunits: number, currency = 'CZK'): string {
  if (!Number.isInteger(subunits)) {
    throw new Error(`Invalid subunit value: ${subunits} — must be an integer`);
  }

  if (subunits < 0) {
    throw new Error(`Invalid subunit value: ${subunits} — must be non-negative`);
  }

  const divisor = CURRENCY_SUBUNITS[currency] ?? 100;
  const decimals = divisor === 1 ? 0 : Math.round(Math.log10(divisor));
  const majorUnits = subunits / divisor;
  const locale = CURRENCY_LOCALES[currency] ?? 'en-US';

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(majorUnits);
}

/**
 * Vrati pocet subunitu v 1 hlavni jednotce meny.
 * CZK → 100 (halere), EUR → 100 (centy), JPY → 1
 */
export function getSubunitMultiplier(currency: string): number {
  return CURRENCY_SUBUNITS[currency] ?? 100;
}

/**
 * Vrati symbol meny.
 */
export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? currency;
}

/**
 * Vrati pocet desetinnych mist pro menu.
 * CZK/EUR/USD → 2, JPY → 0
 */
export function getCurrencyDecimals(currency: string): number {
  const subunit = CURRENCY_SUBUNITS[currency] ?? 100;
  return subunit === 1 ? 0 : Math.round(Math.log10(subunit));
}

/**
 * Konvertuje major units (koruny, eura) na subunity (halere, centy).
 * Opatrne zaokrouhli na nejblizsi subunit.
 *
 * @example
 * toSubunits(150.50, 'CZK')  // 15050
 * toSubunits(12.99, 'EUR')   // 1299
 * toSubunits(1000, 'JPY')    // 1000
 */
export function toSubunits(majorUnits: number, currency: string): number {
  const multiplier = CURRENCY_SUBUNITS[currency] ?? 100;
  return Math.round(majorUnits * multiplier);
}

/**
 * Konvertuje subunity na major units.
 *
 * @example
 * toMajorUnits(15050, 'CZK')  // 150.50
 * toMajorUnits(1000, 'JPY')   // 1000
 */
export function toMajorUnits(subunits: number, currency: string): number {
  const divisor = CURRENCY_SUBUNITS[currency] ?? 100;
  return subunits / divisor;
}
