/**
 * Formatovací utility — money + dates s podporou multi-currency.
 */

export type Currency = 'CZK' | 'EUR' | 'USD' | 'GBP' | 'PLN';

const CURRENCY_LOCALE: Record<Currency, string> = {
  CZK: 'cs-CZ',
  EUR: 'de-DE',
  USD: 'en-US',
  GBP: 'en-GB',
  PLN: 'pl-PL',
};

const CURRENCY_SYMBOL: Record<Currency, string> = {
  CZK: 'Kč',
  EUR: '€',
  USD: '$',
  GBP: '£',
  PLN: 'zł',
};

export function isCurrency(value: unknown): value is Currency {
  return (
    typeof value === 'string' &&
    (value === 'CZK' || value === 'EUR' || value === 'USD' || value === 'GBP' || value === 'PLN')
  );
}

/**
 * Formátuje minor units (haléře/cents) v dané měně.
 * formatMoney(98000, 'CZK') → "980 Kč"
 * formatMoney(2500, 'EUR')  → "25,00 €"
 */
export function formatMoney(minorUnits: number, currency: Currency = 'CZK', locale?: string): string {
  const major = minorUnits / 100;
  const loc = locale ?? CURRENCY_LOCALE[currency];
  try {
    return new Intl.NumberFormat(loc, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
      minimumFractionDigits: currency === 'CZK' ? 0 : 2,
    }).format(major);
  } catch {
    return `${major.toLocaleString(loc)} ${CURRENCY_SYMBOL[currency]}`;
  }
}

/**
 * Backward-compatible: stejné jako formatMoney(halire, 'CZK').
 * @deprecated Použij formatMoney pro multi-currency podporu.
 */
export function formatCzk(halire: number): string {
  return formatMoney(halire, 'CZK');
}

export function formatCzechDate(isoDate: string): string {
  const date = new Date(isoDate);
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatCzechDateShort(isoDate: string): string {
  const date = new Date(isoDate);
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(date);
}

/**
 * Locale-aware date format.
 * formatDate('2026-06-15T19:00:00Z', 'en') → "June 15, 2026, 7:00 PM"
 */
export function formatDate(isoDate: string, locale: string = 'cs'): string {
  const date = new Date(isoDate);
  return new Intl.DateTimeFormat(locale === 'cs' ? 'cs-CZ' : locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
