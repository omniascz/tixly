/**
 * Parsery kurzovych listku z CNB a ECB.
 * Prevzato z @acc/accounting currency.ts a adaptovano pro Tixly.
 *
 * CNB: textovy format, kurzy vztazene k CZK
 * ECB: XML format, kurzy vztazene k EUR
 */

import type { ExchangeRateInput } from '../types/currency.js';

/**
 * Parsuje denni kurzovy listek CNB (Ceska narodni banka).
 *
 * Format:
 * ```
 * 12.04.2026 #73
 * zeme|mena|mnozstvi|kod|kurz
 * Australie|dolar|1|AUD|15,432
 * EMU|euro|1|EUR|25,210
 * Japonsko|jen|100|JPY|16,841
 * ```
 *
 * CNB kurzy vyjadruju: kolik CZK za `mnozstvi` jednotek cizi meny.
 * Pro JPY je mnozstvi=100, takze rate se deli mnozstvim.
 */
export function parseCnbRates(text: string, date: string): ExchangeRateInput[] {
  const lines = text.trim().split('\n');
  const rates: ExchangeRateInput[] = [];

  // Prvni 2 radky jsou hlavicka (datum + nazvy sloupcu)
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length < 5) continue;

    const amount = Number(parts[2]!.trim());
    const code = parts[3]!.trim();
    const rateRaw = parts[4]!.trim().replace(',', '.');
    const ratePerUnit = Number(rateRaw) / amount;

    if (!isFinite(ratePerUnit) || ratePerUnit <= 0) continue;

    rates.push({
      date,
      base: 'CZK',
      quote: code,
      rate: ratePerUnit.toFixed(8),
      source: 'CNB',
    });
  }

  return rates;
}

/**
 * Parsuje denni kurzy ECB (Evropska centralni banka) z XML.
 *
 * ECB XML format:
 * ```xml
 * <Cube currency='USD' rate='1.0842'/>
 * <Cube currency='GBP' rate='0.85670'/>
 * ```
 *
 * Vsechny kurzy jsou vztazene k EUR (1 EUR = rate jednotek cizi meny).
 */
export function parseEcbRates(xml: string, date: string): ExchangeRateInput[] {
  const rates: ExchangeRateInput[] = [];
  const cubeRegex = /currency='([A-Z]{3})'\s+rate='([0-9.]+)'/g;
  let match;

  while ((match = cubeRegex.exec(xml)) !== null) {
    const code = match[1]!;
    const rate = match[2]!;
    const rateNum = Number(rate);

    if (!isFinite(rateNum) || rateNum <= 0) continue;

    rates.push({
      date,
      base: 'EUR',
      quote: code,
      rate: rateNum.toFixed(8),
      source: 'ECB',
    });
  }

  return rates;
}
