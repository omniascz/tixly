/**
 * Multi-currency types pro Tixly.
 * Adaptovano z @acc/accounting currency engine.
 */

/** ISO 4217 meny aktivne podporovane platformou */
export type SupportedCurrency = 'CZK' | 'EUR' | 'USD' | 'GBP' | 'PLN' | 'HUF' | 'CHF' | 'SEK' | 'NOK' | 'DKK' | 'JPY';

/** Zdroj kurzu */
export type RateSource = 'CNB' | 'ECB' | 'MANUAL';

/** Radek z platform.currencies */
export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  subunit: number;
  is_active: boolean;
}

/** Radek z platform.exchange_rates */
export interface ExchangeRate {
  id: string;
  rate_date: string;
  base: string;
  quote: string;
  rate: string;
  source: RateSource;
  created_at: string;
}

/** Vstup pro ulozeni kurzu */
export interface ExchangeRateInput {
  date: string;
  base: string;
  quote: string;
  rate: string;
  source: RateSource;
}

/** Vysledek konverze */
export interface CurrencyConversion {
  amountSubunits: number;
  from: string;
  to: string;
  rate: string;
  resultSubunits: number;
  date: string;
}

/** Mapovani men na pocet subunitu (halere, centy, ...) */
export const CURRENCY_SUBUNITS: Record<string, number> = {
  CZK: 100,
  EUR: 100,
  USD: 100,
  GBP: 100,
  PLN: 100,
  HUF: 100,
  CHF: 100,
  SEK: 100,
  NOK: 100,
  DKK: 100,
  JPY: 1,
};

/** Mapovani men na symboly */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  CZK: 'Kč',
  EUR: '€',
  USD: '$',
  GBP: '£',
  PLN: 'zł',
  HUF: 'Ft',
  CHF: 'Fr',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  JPY: '¥',
};

/** Mapovani men na locale pro Intl.NumberFormat */
export const CURRENCY_LOCALES: Record<string, string> = {
  CZK: 'cs-CZ',
  EUR: 'de-DE',
  USD: 'en-US',
  GBP: 'en-GB',
  PLN: 'pl-PL',
  HUF: 'hu-HU',
  CHF: 'de-CH',
  SEK: 'sv-SE',
  NOK: 'nb-NO',
  DKK: 'da-DK',
  JPY: 'ja-JP',
};
