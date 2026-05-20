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

const ARES_BASE_URL = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty';
const REQUEST_TIMEOUT_MS = 5_000;

export interface AresCheckResult {
  /** IČO existuje v ARES */
  valid: boolean;
  /** Subjekt je aktivní (ne v likvidaci/zaniklý) */
  active: boolean;
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
    return { valid: false, active: false, error: 'INVALID_FORMAT' };
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${ARES_BASE_URL}/${normalized}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    if (res.status === 404) {
      return { valid: false, active: false, error: 'NOT_FOUND' };
    }
    if (!res.ok) {
      return { valid: false, active: false, error: `HTTP_${res.status}` };
    }

    const data = (await res.json()) as AresApiResponse;
    const active = data.datumZaniku === null || data.datumZaniku === undefined;

    return {
      valid: true,
      active,
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
    if (msg.includes('abort')) {
      return { valid: false, active: false, error: 'TIMEOUT' };
    }
    return { valid: false, active: false, error: msg.slice(0, 200) };
  }
}

/**
 * Spočítá initial risk score promotéra z ARES výsledku.
 * 0 = trusted, 100 = vysoké riziko.
 *
 * Heuristika:
 *   ARES not found      → +50 (možná zahraniční / falešné IČO)
 *   ARES inactive       → +100 (zaniklý subjekt!)
 *   No DIČ              → +10 (ne plátce DPH, ale OK)
 *   Vznik < 6 měsíců    → +15 (nově založená firma)
 *   Vznik < 30 dní      → +30 (čerstvě založená, podezřelé)
 */
export function computeInitialRiskScore(ares: AresCheckResult): number {
  let score = 50; // baseline T1 medium risk

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
