/**
 * ARES (Administrativní registr ekonomických subjektů) verification.
 *
 * V produkci voláme: https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}
 * (přes lib/compliance/ares.ts — kolo 7).
 *
 * Vrací JSON s firemními údaji. V demu mock pro známé hodnoty (8-mistné IČO se sumou
 * podle algoritmu). Real ARES validation:
 *   1. IČO musí být 8 čísel
 *   2. Validation digit přes mod 11 algoritmus
 *   3. ARES API call → ověření, že existuje subjekt + získání jména a adresy
 */

import { checkAres } from '@/lib/compliance/ares';

export interface AresResult {
  valid: boolean;
  ico: string;
  companyName?: string;
  address?: string;
  dic?: string;
  active?: boolean;
  error?: string;
  /** ARES nebyl dostupný (výpadek, 5xx, timeout) — o IČO nic nevíme → ruční ověření (kolo 7). */
  unavailable: boolean;
}

/**
 * Validate IČO checksum (mod 11 algoritmus).
 */
function validIcoChecksum(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false;
  const digits = ico.split('').map((d) => Number.parseInt(d, 10));
  const weights = [8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += digits[i] * weights[i];
  const remainder = sum % 11;
  let checkDigit: number;
  if (remainder === 0) checkDigit = 1;
  else if (remainder === 1) checkDigit = 0;
  else checkDigit = 11 - remainder;
  return checkDigit === digits[7];
}

export async function verifyIco(ico: string): Promise<AresResult> {
  const cleaned = ico.replace(/\s/g, '').padStart(8, '0');
  if (!validIcoChecksum(cleaned)) {
    return { valid: false, ico: cleaned, error: 'INVALID_CHECKSUM', unavailable: false };
  }

  // Mock pro demo / vývoj. Kolo 7: v produkci ne — tam by potvrdil libovolné IČO s platným součtem.
  if (process.env.ARES_MODE === 'mock' && process.env.NODE_ENV !== 'production') {
    return {
      valid: true,
      ico: cleaned,
      companyName: `Mock Company ${cleaned}`,
      address: 'Václavské nám. 1, 110 00 Praha 1',
      dic: `CZ${cleaned}`,
      active: true,
      unavailable: false,
    };
  }

  // Kolo 7: jeden klient ARES pro registraci i KYC (lib/compliance/ares.ts — ARES_BASE_URL,
  // ARES_TIMEOUT_MS, rozlišení výpadku od neexistujícího IČO).
  const r = await checkAres(cleaned);
  if (r.outcome === 'verified' || r.outcome === 'inactive') {
    return { valid: true, ico: cleaned, companyName: r.legalName, address: r.address, dic: r.dic, active: r.active, unavailable: false };
  }
  return {
    valid: false,
    ico: cleaned,
    error: r.outcome === 'unavailable' ? `ARES_UNAVAILABLE: ${r.error ?? ''}`.trim() : (r.error ?? 'NOT_FOUND'),
    unavailable: r.outcome === 'unavailable',
  };
}
