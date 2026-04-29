/**
 * Currency exchange rates pro display "approx in your currency".
 *
 * Note: NEPOUŽÍVAT pro charge — server vždy charguje v `event.currency`.
 * Tohle je jen UI hint pro buyera ("event in EUR, approximately ~625 CZK").
 *
 * V produkci tohle taháme z ČNB API / Fixer / OpenExchangeRates a cache 1h.
 * V demu jsou hardcoded mid-rates k 2026-04 (vůči CZK).
 */

import type { Currency } from './format';

// Mid-market rates k CZK (2026-04 přibližné)
const RATES_TO_CZK: Record<Currency, number> = {
  CZK: 1,
  EUR: 25.0,
  USD: 23.5,
  GBP: 29.5,
  PLN: 5.85,
};

export function convertMinor(
  amountMinor: number,
  fromCurrency: Currency,
  toCurrency: Currency,
): number {
  if (fromCurrency === toCurrency) return amountMinor;
  const inCzk = (amountMinor * RATES_TO_CZK[fromCurrency]) / RATES_TO_CZK[toCurrency];
  return Math.round(inCzk);
}

/**
 * Returns an approximate conversion for UI hint.
 * Use case: event je v EUR, buyer je v ČR → "~625 CZK" pod EUR cenou.
 */
export function approximateInCurrency(
  amountMinor: number,
  fromCurrency: Currency,
  toCurrency: Currency,
): { converted: number; rate: number } | null {
  if (fromCurrency === toCurrency) return null;
  const converted = convertMinor(amountMinor, fromCurrency, toCurrency);
  const rate = RATES_TO_CZK[fromCurrency] / RATES_TO_CZK[toCurrency];
  return { converted, rate };
}
