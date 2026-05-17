/**
 * DPH sazby per země + per kategorie.
 *
 * CZ + SR jsou primary trhy. Hodnoty jsou v procentech (10 = 10 %).
 * Hard-coded backup; runtime by mohl číst z `platform.config.vat_rates`
 * pokud bude třeba dynamicky měnit.
 *
 * SK specifika:
 *   - Kulturní akce mají 5 % DPH (ne 10 % jako v CZ)
 *   - Reduced rate je obvykle 5 % nebo 10 % (zákon o DPH §27)
 *
 * Reference:
 *   - CZ: zákon č. 235/2004 Sb. (DPH)
 *   - SR: zákon č. 222/2004 Z. z. (DPH)
 */

export type Country = 'CZ' | 'SR';

export type VatCategory =
  | 'standard'       // 21 % CZ / 23 % SR
  | 'cultural'       // 10 % CZ / 5 % SR  ← KEY pro ticketing
  | 'food_beverage'  // 12 % CZ / 19 % SR (F&B addony)
  | 'merchandise'    // 21 % CZ / 23 % SR
  | 'reduced';       // 10 % CZ / 5 % SR (alias pro cultural)

const RATES: Record<Country, Record<VatCategory, number>> = {
  CZ: {
    standard: 21,
    cultural: 10,
    food_beverage: 12,
    merchandise: 21,
    reduced: 10,
  },
  SR: {
    standard: 23,
    cultural: 5,
    food_beverage: 19,
    merchandise: 23,
    reduced: 5,
  },
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
  const country: Country = input.country === 'SR' ? 'SR' : 'CZ';
  const category = (input.vatCategory as VatCategory) || 'cultural';
  if (!RATES[country][category]) {
    return RATES[country].cultural;
  }
  return getVatRate(country, category);
}
