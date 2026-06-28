/**
 * EU VIES VAT number validation.
 *
 * VIES = VAT Information Exchange System (European Commission).
 * API: https://ec.europa.eu/taxation_customs/vies/services/checkVatService (SOAP)
 * Also available as JSON: /rest/checkVat?countryCode=DE&vatNumber=123456789
 *
 * Used for:
 *   - EU B2B reverse charge: buyer provides VAT ID → 0% VAT
 *   - ISDOC invoices for cross-border B2B
 *   - Finance audit trail (vies_checks table)
 *
 * Fallback: if VIES is unavailable, return valid=false (fail-safe — don't grant 0% without confirmation).
 */

export interface ViesCheckResult {
  isValid: boolean;
  countryCode: string;
  vatNumber: string;
  name?: string;
  address?: string;
  requestedAt: string;
}

const VIES_BASE = 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms';

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES',
  'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]);

function parseVatNumber(rawVatNumber: string): { countryCode: string; number: string } | null {
  const cleaned = rawVatNumber.replace(/[\s.-]/g, '').toUpperCase();
  if (cleaned.length < 4) return null;

  // Try to extract country prefix
  const prefix = cleaned.slice(0, 2);
  if (EU_COUNTRY_CODES.has(prefix)) {
    return { countryCode: prefix, number: cleaned.slice(2) };
  }
  // UK VAT (GB prefix, post-Brexit — not VIES but still useful)
  if (prefix === 'GB') {
    return { countryCode: 'GB', number: cleaned.slice(2) };
  }
  return null;
}

/**
 * Validate an EU VAT number via VIES REST API.
 * Returns isValid=false on network errors (fail-safe).
 *
 * @param rawVatNumber e.g. "DE123456789" or "CZ12345678"
 */
export async function validateVatNumber(rawVatNumber: string): Promise<ViesCheckResult> {
  const requestedAt = new Date().toISOString();
  const parsed = parseVatNumber(rawVatNumber);

  if (!parsed) {
    return { isValid: false, countryCode: '', vatNumber: rawVatNumber, requestedAt };
  }

  // UK not on VIES — accept without check if format looks valid (9 digits standard)
  if (parsed.countryCode === 'GB') {
    const isValid = /^\d{9}$/.test(parsed.number) || /^\d{12}$/.test(parsed.number);
    return { isValid, countryCode: 'GB', vatNumber: rawVatNumber, requestedAt };
  }

  // VIES REST endpoint (JSON, no SOAP needed)
  const url = `${VIES_BASE}/${parsed.countryCode}/vat/${parsed.number}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      console.warn(`[vies] HTTP ${res.status} for ${rawVatNumber}`);
      return { isValid: false, countryCode: parsed.countryCode, vatNumber: rawVatNumber, requestedAt };
    }

    const json = await res.json() as {
      isValid: boolean;
      name?: string;
      address?: string;
    };

    return {
      isValid: json.isValid,
      countryCode: parsed.countryCode,
      vatNumber: rawVatNumber,
      name: json.name ?? undefined,
      address: json.address ?? undefined,
      requestedAt,
    };
  } catch (err) {
    console.warn(`[vies] request failed for ${rawVatNumber}:`, err);
    // Fail-safe: treat as invalid so we don't grant 0% on network errors
    return { isValid: false, countryCode: parsed.countryCode, vatNumber: rawVatNumber, requestedAt };
  }
}

/**
 * Determines if EU B2B reverse charge should apply.
 *
 * Conditions (Art. 44, Directive 2006/112/EC):
 *   1. Buyer has a valid EU VAT number
 *   2. Buyer's country ≠ seller's (promoter's) country
 *   3. Transaction is B2B (both are VAT-registered businesses)
 *
 * @param buyerCountryCode  2-letter country code from the VAT number
 * @param sellerCountryCode promoter's country code
 */
export function isReverseChargeApplicable(
  buyerCountryCode: string,
  sellerCountryCode: string,
): boolean {
  if (!EU_COUNTRY_CODES.has(buyerCountryCode)) return false;
  if (!EU_COUNTRY_CODES.has(sellerCountryCode)) return false;
  return buyerCountryCode !== sellerCountryCode;
}

/**
 * Parse country code from raw VAT number string.
 * Returns null if not parseable.
 */
export function getCountryCodeFromVat(rawVatNumber: string): string | null {
  return parseVatNumber(rawVatNumber)?.countryCode ?? null;
}
