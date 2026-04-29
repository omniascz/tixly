/**
 * VAT engine — Czech VAT calculation adapted from @acc/accounting.
 *
 * All amounts in haléře (integer, 1 Kč = 100 haléřů).
 * Implements Czech VAT law (zákon č. 235/2004 Sb.) with 2024+ rates.
 *
 * Ported from Accounting project (Decimal.js → integer haléře).
 */

// ---------------------------------------------------------------------------
// Constants — Czech VAT rates (2024+)
// ---------------------------------------------------------------------------

/** VAT rates as basis points (21% = 2100, 12% = 1200, 0% = 0) */
export const CZ_VAT_RATES_BP = {
  standard: 2100,   // 21 %
  reduced: 1200,    // 12 % (merged from old 15% + 10%)
  zero: 0,          // 0 % (exempt / export)
} as const;

/** VAT rates as decimals for display */
export const CZ_VAT_RATES_PERCENT = {
  standard: 21,
  reduced: 12,
  zero: 0,
} as const;

export type VatRateType = 'standard' | 'reduced' | 'zero';

export type VatScheme =
  | 'standard'        // běžný režim
  | 'reverse_charge'  // přenesení daňové povinnosti (PDP)
  | 'exempt'          // osvobozeno od DPH
  | 'non_vat'         // neplátce DPH
  | 'oss'             // One Stop Shop (EU e-commerce)
  | 'intra_eu'        // intra-community supply/acquisition
  | 'third_country';  // export/import outside EU

// Reverse charge categories (příloha 6 zákona o DPH)
export const CZ_REVERSE_CHARGE_CATEGORIES = [
  { code: 'construction', name: 'Stavební a montážní práce', czCpa: '41-43' },
  { code: 'waste', name: 'Obchodování s odpady', czCpa: '38' },
  { code: 'metals', name: 'Dodání kovů', czCpa: '24' },
  { code: 'cereals', name: 'Dodání obilovin a technických plodin', czCpa: '01.1' },
  { code: 'electronics', name: 'Dodání elektroniky (mobily, tablety, laptopy)', czCpa: '26' },
  { code: 'gas_electricity', name: 'Dodání plynu a elektřiny', czCpa: '35' },
  { code: 'emission_permits', name: 'Emisní povolenky', czCpa: 'n/a' },
] as const;

const REVERSE_CHARGE_CODES = new Set(
  CZ_REVERSE_CHARGE_CATEGORIES.map((c) => c.code),
);

// EU member state ISO codes (excluding CZ)
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'DK', 'EE', 'FI', 'FR', 'DE',
  'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL',
  'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VatCalculation {
  /** Base amount in haléře (základ daně) */
  baseHalire: number;
  /** VAT amount in haléře */
  vatHalire: number;
  /** Total (base + VAT) in haléře */
  totalHalire: number;
  /** Effective rate in basis points (0 for exempt schemes) */
  effectiveRateBp: number;
}

// ---------------------------------------------------------------------------
// Core calculation functions
// ---------------------------------------------------------------------------

/**
 * Calculate VAT for a base amount.
 * If scheme is reverse_charge, exempt, non_vat, third_country, or intra_eu — vatAmount = 0.
 *
 * @param baseHalire Base amount in haléře (integer)
 * @param vatRateType Which VAT rate to apply
 * @param scheme Optional VAT scheme override
 */
export function calculateVat(
  baseHalire: number,
  vatRateType: VatRateType,
  scheme?: VatScheme,
): VatCalculation {
  if (!Number.isInteger(baseHalire)) {
    throw new Error(`baseHalire must be integer, got ${baseHalire}`);
  }

  const rateBp = CZ_VAT_RATES_BP[vatRateType];

  // Schemes where VAT is not charged by supplier
  const zeroVatSchemes: VatScheme[] = [
    'reverse_charge', 'exempt', 'non_vat', 'third_country', 'intra_eu',
  ];
  if (scheme && zeroVatSchemes.includes(scheme)) {
    return {
      baseHalire,
      vatHalire: 0,
      totalHalire: baseHalire,
      effectiveRateBp: 0,
    };
  }

  // VAT = base × rate / 10000 (basis points)
  const vatHalire = Math.round(baseHalire * rateBp / 10000);
  return {
    baseHalire,
    vatHalire,
    totalHalire: baseHalire + vatHalire,
    effectiveRateBp: rateBp,
  };
}

/**
 * Calculate VAT from gross (total) amount — reverse calculation.
 * base = gross × 10000 / (10000 + rateBp); vat = gross - base
 *
 * @param grossHalire Total amount including VAT, in haléře
 * @param vatRateType Which VAT rate
 */
export function calculateVatFromGross(
  grossHalire: number,
  vatRateType: VatRateType,
): { baseHalire: number; vatHalire: number } {
  if (!Number.isInteger(grossHalire)) {
    throw new Error(`grossHalire must be integer, got ${grossHalire}`);
  }

  const rateBp = CZ_VAT_RATES_BP[vatRateType];
  const baseHalire = Math.round(grossHalire * 10000 / (10000 + rateBp));
  const vatHalire = grossHalire - baseHalire;

  return { baseHalire, vatHalire };
}

/**
 * Determine if reverse charge applies.
 * PDP if: CZ→CZ + matching category, or EU→CZ (intra-community acquisition).
 */
export function isReverseCharge(
  supplierCountry: string,
  buyerCountry: string,
  categoryCode?: string,
): boolean {
  // Domestic reverse charge (CZ→CZ) — requires matching category
  if (supplierCountry === 'CZ' && buyerCountry === 'CZ') {
    return !!categoryCode && REVERSE_CHARGE_CODES.has(categoryCode);
  }

  // EU intra-community acquisition (EU→CZ) — always reverse charge
  if (EU_COUNTRIES.has(supplierCountry) && buyerCountry === 'CZ') {
    return true;
  }

  return false;
}

/**
 * Determine VAT scheme for a transaction.
 */
export function determineVatScheme(
  supplierCountry: string,
  buyerCountry: string,
  supplierIsVatPayer: boolean,
  _buyerIsVatPayer: boolean,
  categoryCode?: string,
): VatScheme {
  if (!supplierIsVatPayer) return 'non_vat';

  const isSupplierEu = supplierCountry === 'CZ' || EU_COUNTRIES.has(supplierCountry);
  const isBuyerEu = buyerCountry === 'CZ' || EU_COUNTRIES.has(buyerCountry);

  if (!isSupplierEu || !isBuyerEu) return 'third_country';

  if (supplierCountry !== buyerCountry && isSupplierEu && isBuyerEu) {
    return 'intra_eu';
  }

  if (supplierCountry === 'CZ' && buyerCountry === 'CZ') {
    if (categoryCode && REVERSE_CHARGE_CODES.has(categoryCode)) {
      return 'reverse_charge';
    }
    return 'standard';
  }

  return 'standard';
}

/**
 * Validate CZ DIČ format: CZ + 8-10 digits.
 */
export function validateDic(dic: string): boolean {
  return /^CZ\d{8,10}$/.test(dic);
}

/**
 * Check if a country is in the EU.
 */
export function isEuCountry(countryCode: string): boolean {
  return countryCode === 'CZ' || EU_COUNTRIES.has(countryCode);
}
