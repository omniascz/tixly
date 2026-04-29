/**
 * ARES (Administrativní registr ekonomických subjektů) verification.
 *
 * V produkci voláme: https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}
 *
 * Vrací JSON s firemními údaji. V demu mock pro známé hodnoty (8-mistné IČO se sumou
 * podle algoritmu). Real ARES validation:
 *   1. IČO musí být 8 čísel
 *   2. Validation digit přes mod 11 algoritmus
 *   3. ARES API call → ověření, že existuje subjekt + získání jména a adresy
 */

export interface AresResult {
  valid: boolean;
  ico: string;
  companyName?: string;
  address?: string;
  dic?: string;
  active?: boolean;
  error?: string;
}

/**
 * Validate IČO checksum (mod 11 algoritmus).
 */
function validIcoChecksum(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false;
  const digits = ico.split('').map((d) => Number.parseInt(d, 10));
  const weights = [8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += digits[i]! * weights[i]!;
  const remainder = sum % 11;
  let checkDigit: number;
  if (remainder === 0) checkDigit = 1;
  else if (remainder === 1) checkDigit = 0;
  else checkDigit = 11 - remainder;
  return checkDigit === digits[7]!;
}

export async function verifyIco(ico: string): Promise<AresResult> {
  const cleaned = ico.replace(/\s/g, '').padStart(8, '0');
  if (!validIcoChecksum(cleaned)) {
    return { valid: false, ico: cleaned, error: 'INVALID_CHECKSUM' };
  }

  // Pokud je nastaven mock flag, vrátíme stub (pro demo / testing)
  if (process.env.ARES_MODE === 'mock') {
    return {
      valid: true,
      ico: cleaned,
      companyName: `Mock Company ${cleaned}`,
      address: 'Václavské nám. 1, 110 00 Praha 1',
      dic: `CZ${cleaned}`,
      active: true,
    };
  }

  // Production: real ARES API call
  try {
    const url = `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${cleaned}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) {
      return { valid: false, ico: cleaned, error: 'NOT_FOUND' };
    }
    if (!res.ok) {
      return { valid: false, ico: cleaned, error: `ARES_HTTP_${res.status}` };
    }
    const data = (await res.json()) as {
      obchodniJmeno?: string;
      sidlo?: { textovaAdresa?: string };
      dic?: string;
      czNace?: unknown;
      datumZaniku?: string | null;
    };
    return {
      valid: true,
      ico: cleaned,
      companyName: data.obchodniJmeno,
      address: data.sidlo?.textovaAdresa,
      dic: data.dic,
      active: !data.datumZaniku,
    };
  } catch (err) {
    return {
      valid: false,
      ico: cleaned,
      error: `ARES_FETCH_FAILED: ${(err as Error).message}`,
    };
  }
}
