import type { Locale } from '../lib/types.js';

type Currency = 'CZK' | 'EUR';

/**
 * Default currency per locale.
 * cs/sk/de default to CZK; callers can override to EUR.
 */
function defaultCurrency(locale: Locale): Currency {
  return locale === 'sk' ? 'EUR' : 'CZK';
}

/**
 * Formats an amount given in haléře (1/100 of CZK) or euro cents (1/100 EUR)
 * into a localised currency string.
 *
 * cs:  '1 250 Kč'   (space as thousands separator, symbol after)
 * en:  'CZK 1,250'  (comma as thousands separator, ISO code before)
 * de:  '1.250 CZK'  (dot as thousands separator, ISO code after)
 * sk:  '12,50 €'    (comma as decimal, € symbol after) — when EUR
 *      '1 250 Kč'   (when CZK, same style as cs)
 */
export function formatCurrency(
  amountHalire: number,
  locale: Locale,
  currency?: Currency,
): string {
  const cur = currency ?? defaultCurrency(locale);
  const majorUnits = amountHalire / 100;

  switch (locale) {
    case 'cs': {
      // '1 250 Kč' — non-breaking space as thousands separator
      const formatted = formatWithSeparator(majorUnits, ' ', ',', cur === 'EUR' ? 2 : 0);
      const symbol = cur === 'EUR' ? '€' : 'Kč';
      return `${formatted} ${symbol}`;
    }
    case 'sk': {
      if (cur === 'EUR') {
        const formatted = formatWithSeparator(majorUnits, ' ', ',', 2);
        return `${formatted} €`;
      }
      // CZK in sk — same style as cs
      const formatted = formatWithSeparator(majorUnits, ' ', ',', 0);
      return `${formatted} Kč`;
    }
    case 'en': {
      // 'CZK 1,250' or 'EUR 1,250.00'
      const decimals = cur === 'EUR' ? 2 : 0;
      const formatted = formatWithSeparator(majorUnits, ',', '.', decimals);
      return `${cur} ${formatted}`;
    }
    case 'de': {
      // '1.250 CZK' or '1.250,00 EUR'
      const decimals = cur === 'EUR' ? 2 : 0;
      const formatted = formatWithSeparator(majorUnits, '.', ',', decimals);
      return `${formatted} ${cur}`;
    }
    default: {
      return `${majorUnits} ${cur}`;
    }
  }
}

/**
 * Parses a formatted currency string back to haléře (integer).
 * Strips known currency symbols/codes and separators, then multiplies by 100.
 * This is a best-effort inverse; precision may vary for locales using decimal separators.
 */
export function parseCurrencyToHalire(formatted: string, locale: Locale): number {
  // Remove currency symbols and codes
  let cleaned = formatted
    .replace(/Kč|CZK|EUR|€/gi, '')
    .trim();

  switch (locale) {
    case 'cs':
    case 'sk':
      // thousands sep = space, decimal sep = comma
      cleaned = cleaned.replace(/\s/g, '').replace(',', '.');
      break;
    case 'en':
      // thousands sep = comma, decimal sep = dot
      cleaned = cleaned.replace(/,/g, '');
      break;
    case 'de':
      // thousands sep = dot, decimal sep = comma
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      break;
  }

  const value = parseFloat(cleaned.trim());
  if (isNaN(value)) {
    throw new Error(`Cannot parse currency string: "${formatted}"`);
  }
  return Math.round(value * 100);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Formats a number with configurable thousands separator, decimal separator and decimal places.
 */
function formatWithSeparator(
  value: number,
  thousandsSep: string,
  decimalSep: string,
  decimals: number,
): string {
  const fixed = value.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSep);
  if (decimals === 0 || decPart === undefined) {
    return intFormatted;
  }
  return `${intFormatted}${decimalSep}${decPart}`;
}
