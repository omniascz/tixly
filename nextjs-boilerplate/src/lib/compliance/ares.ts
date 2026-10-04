/**
 * ARES (Administrativní registr ekonomických subjektů) — CZ státní register.
 *
 * Free API: https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/<ICO>
 *
 * Vrací JSON s daty z obchodního rejstříku:
 *   - obchodní jméno
 *   - adresa sídla
 *   - status (aktivní / v likvidaci / zaniklý)
 *   - DIČ (pokud plátce DPH)
 *   - datum vzniku / zániku
 *
 * Použití:
 *   const result = await checkAres('12345678');
 *   if (!result.valid || !result.active) → reject promoter registration
 *
 * Rate limit: ARES.gov nemá officiální, ale doporučeno < 100 req/s.
 */

const ARES_DEFAULT_BASE_URL = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty';
const ARES_DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Kolo 7: adresa a timeout jdou nastavit (ARES_BASE_URL, ARES_TIMEOUT_MS) — testy míří na simulátor
 * tests/helpers/fake-ares.mjs. Čte se při každém volání, ne při načtení modulu.
 */
function aresBaseUrl(): string {
  return (process.env.ARES_BASE_URL || ARES_DEFAULT_BASE_URL).replace(/\/+$/, '');
}
function aresTimeoutMs(): number {
  const n = Number(process.env.ARES_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : ARES_DEFAULT_TIMEOUT_MS;
}

/**
 * Výsledek ověření (kolo 7). `unavailable` = ARES neodpověděl (výpadek, 5xx, 429, timeout, síť) —
 * o IČO nic nevíme a pořadatel jde do ručního ověření. Dřív se to nedalo odlišit od neexistujícího IČO.
 */
export type AresOutcome = 'verified' | 'not_found' | 'inactive' | 'unavailable' | 'invalid' | 'not_provided';

export interface AresCheckResult {
  /** IČO existuje v ARES */
  valid: boolean;
  /** Subjekt je aktivní (ne v likvidaci/zaniklý) */
  active: boolean;
  /** Rozlišený výsledek (kolo 7) */
  outcome: AresOutcome;
  /** Obchodní jméno z registru */
  legalName?: string;
  /** Adresa sídla */
  address?: string;
  /** DIČ (pokud plátce DPH) */
  dic?: string;
  /** Datum vzniku */
  registeredAt?: string;
  /** Datum zániku (pokud zanikl) */
  dissolvedAt?: string;
  /** Raw response pro audit log */
  raw?: unknown;
  /** Error message pokud check selhal */
  error?: string;
}

interface AresApiResponse {
  ico?: string;
  dic?: string;
  obchodniJmeno?: string;
  datumVzniku?: string;
  datumZaniku?: string | null;
  sidlo?: {
    textovaAdresa?: string;
    nazevObce?: string;
    psc?: string;
  };
  pravniForma?: {
    nazev?: string;
  };
  finance?: {
    datumZaniku?: string | null;
  };
}

/**
 * Ověří CZ IČO v ARES registru.
 *
 * @param ico 8-místné CZ IČO (může s prefixem leading zero)
 */
export async function checkAres(ico: string): Promise<AresCheckResult> {
  const normalized = ico.trim().padStart(8, '0');
  if (!/^\d{8}$/.test(normalized)) {
    return { valid: false, active: false, outcome: 'invalid', error: 'INVALID_FORMAT' };
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), aresTimeoutMs());

  try {
    const res = await fetch(`${aresBaseUrl()}/${normalized}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });

    if (res.status === 404) {
      clearTimeout(timeout);
      return { valid: false, active: false, outcome: 'not_found', error: 'NOT_FOUND' };
    }
    if (!res.ok) {
      clearTimeout(timeout);
      // 5xx / 429 = ARES nedostupný; jiné 4xx (např. 400 u IČO, které ARES odmítne) = neplatný dotaz.
      const unavailable = res.status >= 500 || res.status === 429;
      return { valid: false, active: false, outcome: unavailable ? 'unavailable' : 'invalid', error: `HTTP_${res.status}` };
    }

    const data = (await res.json()) as AresApiResponse;
    clearTimeout(timeout);
    const active = data.datumZaniku === null || data.datumZaniku === undefined;

    return {
      valid: true,
      active,
      outcome: active ? 'verified' : 'inactive',
      legalName: data.obchodniJmeno,
      address: data.sidlo?.textovaAdresa,
      dic: data.dic,
      registeredAt: data.datumVzniku,
      dissolvedAt: data.datumZaniku ?? undefined,
      raw: data,
    };
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    const aborted = ctrl.signal.aborted || msg.toLowerCase().includes('abort');
    return { valid: false, active: false, outcome: 'unavailable', error: aborted ? 'TIMEOUT' : msg.slice(0, 200) };
  }
}

/**
 * Spočítá initial risk score promotéra z ARES výsledku.
 * 0 = trusted, 100 = vysoké riziko.
 *
 * Heuristika:
 *   ARES not found      → +50 (možná zahraniční / falešné IČO)
 *   ARES nedostupný     → baseline 50 + ruční ověření (kolo 7)
 *   ARES inactive       → +100 (zaniklý subjekt!)
 *   No DIČ              → +10 (ne plátce DPH, ale OK)
 *   Vznik < 6 měsíců    → +15 (nově založená firma)
 *   Vznik < 30 dní      → +30 (čerstvě založená, podezřelé)
 */
export function computeInitialRiskScore(ares: Omit<AresCheckResult, 'outcome'> & { outcome?: AresOutcome }): number {
  let score = 50; // baseline T1 medium risk

  // Kolo 7: ARES nedostupný → o IČO nic nevíme; ne +50 jako u neexistujícího IČO, ale ruční ověření
  // (manual_verification_required) a výchozí střední riziko.
  if (ares.outcome === 'unavailable') return score;
  if (!ares.valid) return Math.min(100, score + 50);
  if (!ares.active) return 100;

  if (!ares.dic) score += 10;

  if (ares.registeredAt) {
    const ageDays = Math.floor(
      (Date.now() - new Date(ares.registeredAt).getTime()) / 86_400_000,
    );
    if (ageDays < 30) score += 30;
    else if (ageDays < 180) score += 15;
    else if (ageDays > 365 * 3) score -= 10; // 3+ years = trusted
  }

  return Math.max(0, Math.min(100, score));
}
