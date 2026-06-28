/**
 * DPH sazby per země + per kategorie.
 *
 * CZ + SK jsou primary trhy; EU rozšíření pokrývá DE, AT, PL, NL, BE, FR, UK, HU, HR, RO.
 * Hodnoty jsou v procentech (10 = 10 %).
 *
 * Poznámky ke kategorii 'cultural' (ticketing relevantní):
 *   CZ: 10 %  SK: 5 %  DE: 7 %  AT: 13 %  PL: 8 %
 *   NL: 9 %   BE: 6 %  FR: 5.5 %  UK: 20 % (standard — cultural exempt pouze pro charitativní org)
 *   HU: 27 %  HR: 13 %  RO: 5 %
 *
 * Reference:
 *   - CZ: zákon č. 235/2004 Sb. (DPH)
 *   - SK: zákon č. 222/2004 Z. z. (DPH)
 *   - EU: Directive 2006/112/EC + country amendments 2024
 *   - UK: HMRC VAT Notice 700/1 (post-Brexit)
 */

export type Country =
  | 'CZ' | 'SK'    // Primary markets (SK replaces legacy 'SR')
  | 'SR'           // Legacy alias for SK
  | 'DE' | 'AT' | 'PL' | 'NL' | 'BE' | 'FR' | 'UK'
  | 'HU' | 'HR' | 'RO' | 'IT' | 'ES' | 'PT';

export type VatCategory =
  | 'standard'       // Full VAT rate
  | 'cultural'       // Reduced: vstupenky, kultura  ← KEY pro ticketing
  | 'food_beverage'  // F&B addony
  | 'merchandise'    // Merchandising
  | 'reduced';       // Alias pro cultural

const RATES: Record<Country, Record<VatCategory, number>> = {
  CZ: { standard: 21, cultural: 10, food_beverage: 12, merchandise: 21, reduced: 10 },
  SK: { standard: 23, cultural: 5,  food_beverage: 19, merchandise: 23, reduced: 5  },
  SR: { standard: 23, cultural: 5,  food_beverage: 19, merchandise: 23, reduced: 5  }, // legacy alias
  DE: { standard: 19, cultural: 7,  food_beverage: 7,  merchandise: 19, reduced: 7  },
  AT: { standard: 20, cultural: 13, food_beverage: 10, merchandise: 20, reduced: 13 },
  PL: { standard: 23, cultural: 8,  food_beverage: 8,  merchandise: 23, reduced: 8  },
  NL: { standard: 21, cultural: 9,  food_beverage: 9,  merchandise: 21, reduced: 9  },
  BE: { standard: 21, cultural: 6,  food_beverage: 6,  merchandise: 21, reduced: 6  },
  FR: { standard: 20, cultural: 5,  food_beverage: 10, merchandise: 20, reduced: 5  },  // spectacles vivants 5.5 → 5 (approx)
  UK: { standard: 20, cultural: 20, food_beverage: 20, merchandise: 20, reduced: 5  },  // UK: cultural = standard; reduced = 5 % (limited)
  HU: { standard: 27, cultural: 27, food_beverage: 27, merchandise: 27, reduced: 5  },  // HU: no cultural reduced for standard events
  HR: { standard: 25, cultural: 13, food_beverage: 5,  merchandise: 25, reduced: 13 },
  RO: { standard: 19, cultural: 5,  food_beverage: 9,  merchandise: 19, reduced: 5  },
  IT: { standard: 22, cultural: 10, food_beverage: 10, merchandise: 22, reduced: 10 },
  ES: { standard: 21, cultural: 21, food_beverage: 10, merchandise: 21, reduced: 10 },  // ES: spektákly 21 % (žádná reduced pro live events)
  PT: { standard: 23, cultural: 13, food_beverage: 13, merchandise: 23, reduced: 13 },
};

/**
 * Vrátí DPH sazbu v procentech pro danou kombinaci.
 *
 * @param country CZ nebo SR
 * @param category typ akce / položky
 * @returns sazba v % (např. 10 pro CZ cultural)
 */
export function getVatRate(country: Country, category: VatCategory): number {
  return RATES[country][category];
}

/**
 * Rozklad ceny na net + VAT (z gross).
 *
 * Vstup: gross_halire (celková zaplacená částka)
 * Výstup: net + vat tak, že net + vat = gross.
 *
 * Použití v PDF účtence: zobraz „Cena bez DPH X | DPH Y | Celkem Z".
 */
export function splitGrossToNetVat(
  grossHalire: number,
  vatRatePct: number,
): { netHalire: number; vatHalire: number } {
  if (vatRatePct === 0) return { netHalire: grossHalire, vatHalire: 0 };
  const netHalire = Math.round(grossHalire / (1 + vatRatePct / 100));
  const vatHalire = grossHalire - netHalire;
  return { netHalire, vatHalire };
}

/**
 * Resolver: pokud event má vat_category, použij ji. Jinak default cultural.
 * Pokud country je neznámá, fallback na CZ.
 */
export function resolveVatRate(input: {
  country: string | null | undefined;
  vatCategory: string | null | undefined;
}): number {
  const rawCountry = (input.country ?? 'CZ').toUpperCase() as Country;
  const country: Country = RATES[rawCountry] ? rawCountry : 'CZ';
  const category = (input.vatCategory as VatCategory) || 'cultural';
  if (!RATES[country]?.[category]) {
    return RATES[country].cultural;
  }
  return getVatRate(country, category);
}

export interface EffectiveVatResult {
  vatRatePct: number;
  isReverseCharge: boolean;
  reverseChargeNote: string | null;
}

/**
 * Resolve effective VAT rate considering reverse charge (EU B2B cross-border).
 *
 * If buyer_vat_country ≠ seller_country and both are EU countries → 0%, reverse charge.
 * Otherwise falls back to standard resolveVatRate().
 *
 * @param sellerCountry   promoter's country code
 * @param vatCategory     event VAT category
 * @param buyerVatCountry 2-letter country from buyer's EU VAT number (undefined = not provided)
 */
// EU member state codes (UK/GB excluded — post-Brexit)
const EU_MEMBER_STATES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES',
  'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]);

export function resolveEffectiveVatRate(input: {
  sellerCountry: string | null | undefined;
  vatCategory: string | null | undefined;
  buyerVatCountry?: string | null;
}): EffectiveVatResult {
  if (input.buyerVatCountry) {
    const buyer = input.buyerVatCountry.toUpperCase();
    const seller = (input.sellerCountry ?? 'CZ').toUpperCase();
    if (buyer !== seller && EU_MEMBER_STATES.has(buyer) && EU_MEMBER_STATES.has(seller)) {
      // Cross-border EU B2B → reverse charge (Art. 44 Directive 2006/112/EC)
      return {
        vatRatePct: 0,
        isReverseCharge: true,
        reverseChargeNote: 'Přenesená daňová povinnost / Reverse charge – Article 44, Council Directive 2006/112/EC',
      };
    }
  }
  const vatRatePct = resolveVatRate({ country: input.sellerCountry, vatCategory: input.vatCategory });
  return { vatRatePct, isReverseCharge: false, reverseChargeNote: null };
}

/** List all supported countries for UI dropdowns. */
export const SUPPORTED_VAT_COUNTRIES: { code: Country; label: string }[] = [
  { code: 'CZ', label: 'Česká republika (CZ)' },
  { code: 'SK', label: 'Slovensko (SK)' },
  { code: 'DE', label: 'Německo (DE)' },
  { code: 'AT', label: 'Rakousko (AT)' },
  { code: 'PL', label: 'Polsko (PL)' },
  { code: 'NL', label: 'Nizozemsko (NL)' },
  { code: 'BE', label: 'Belgie (BE)' },
  { code: 'FR', label: 'Francie (FR)' },
  { code: 'UK', label: 'Velká Británie (UK)' },
  { code: 'HU', label: 'Maďarsko (HU)' },
  { code: 'HR', label: 'Chorvatsko (HR)' },
  { code: 'RO', label: 'Rumunsko (RO)' },
  { code: 'IT', label: 'Itálie (IT)' },
  { code: 'ES', label: 'Španělsko (ES)' },
  { code: 'PT', label: 'Portugalsko (PT)' },
];
