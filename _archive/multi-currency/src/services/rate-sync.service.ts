/**
 * Rate Sync Service — stahuje denni kurzy z CNB a ECB.
 *
 * Urceno pro spusteni jako cron job (1x denne v pracovni dny).
 * CNB publikuje kurzy kolem 14:30 CET, ECB kolem 16:00 CET.
 *
 * Pouziti:
 *   await syncDailyRates(deps, '2026-04-12');     // konkretni datum
 *   await syncDailyRates(deps);                    // dnes
 */

import type { DbAdapter } from '@tixly/db-adapter';
import { parseCnbRates, parseEcbRates } from '../lib/rate-parser.js';
import { storeExchangeRates } from './currency.service.js';

const CNB_URL = 'https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt';
const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

export interface RateSyncDeps {
  db: DbAdapter;
  fetch?: typeof globalThis.fetch;
}

export interface SyncResult {
  cnbCount: number;
  ecbCount: number;
  date: string;
  errors: string[];
}

/**
 * Stahne a ulozi denni kurzy z CNB i ECB.
 *
 * @param date Datum ve formatu YYYY-MM-DD (vychozi: dnes)
 */
export async function syncDailyRates(
  deps: RateSyncDeps,
  date?: string,
): Promise<SyncResult> {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const targetDate = date ?? new Date().toISOString().slice(0, 10);
  const errors: string[] = [];
  let cnbCount = 0;
  let ecbCount = 0;

  // CNB
  try {
    const cnbDate = formatCnbDate(targetDate);
    const cnbResp = await fetchFn(`${CNB_URL}?date=${cnbDate}`);
    if (!cnbResp.ok) throw new Error(`CNB HTTP ${cnbResp.status}`);
    const cnbText = await cnbResp.text();
    const cnbRates = parseCnbRates(cnbText, targetDate);
    cnbCount = await storeExchangeRates({ db: deps.db }, cnbRates);
  } catch (err) {
    errors.push(`CNB: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ECB
  try {
    const ecbResp = await fetchFn(ECB_URL);
    if (!ecbResp.ok) throw new Error(`ECB HTTP ${ecbResp.status}`);
    const ecbXml = await ecbResp.text();
    const ecbRates = parseEcbRates(ecbXml, targetDate);
    ecbCount = await storeExchangeRates({ db: deps.db }, ecbRates);
  } catch (err) {
    errors.push(`ECB: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { cnbCount, ecbCount, date: targetDate, errors };
}

/**
 * Prevede YYYY-MM-DD na DD.MM.YYYY (format CNB API).
 */
function formatCnbDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}
