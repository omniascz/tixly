/**
 * VAT registration thresholds by country.
 *
 * A promoter below the threshold in their country may be exempt from VAT registration
 * and charges 0% VAT (vat_payer=false in our system).
 *
 * EU OSS (One Stop Shop) threshold: €10,000/year for cross-border B2C sales.
 * Below this threshold, charge domestic VAT; above it, register for OSS and charge
 * buyer's country VAT rate.
 *
 * IMPORTANT for live events: Art. 53 of Directive 2006/112/EC says that admission to
 * events is taxed where the event takes place (promoter's country), NOT where the buyer
 * is. So OSS does NOT apply to physical event tickets regardless of buyer's location.
 * For virtual/online event access (streaming), the same rule applies post-Jan 2025
 * under Directive 2022/542/EU. So Tixly's VAT is always at promoter's country rate.
 *
 * The only cross-border mechanism relevant to ticketing is B2B reverse charge
 * (buyer is a VAT-registered business in a different EU country → 0% VAT).
 *
 * Reference:
 *   - EU: https://taxation-customs.ec.europa.eu/business/vat/oss_en
 *   - CZ: Zákon č. 235/2004 Sb. §94a (2M CZK threshold)
 *   - SK: Zákon č. 222/2004 Z.z. §4 (49,790 EUR)
 *   - DE: UStG §19 (22,000 EUR Kleinunternehmerregelung)
 */

export interface VatThreshold {
  country: string;
  currencyCode: string;
  annualThreshold: number;
  thresholdLabel: string;
  smallBusinessScheme?: string;
}

export const VAT_REGISTRATION_THRESHOLDS: Record<string, VatThreshold> = {
  CZ: {
    country: 'CZ',
    currencyCode: 'CZK',
    annualThreshold: 2_000_000,
    thresholdLabel: '2 000 000 Kč',
    smallBusinessScheme: 'Osvobozená osoba (§6 zákona č. 235/2004 Sb.)',
  },
  SK: {
    country: 'SK',
    currencyCode: 'EUR',
    annualThreshold: 49_790,
    thresholdLabel: '49 790 €',
    smallBusinessScheme: 'Zdaniteľná osoba (§4 zákona č. 222/2004 Z.z.)',
  },
  DE: {
    country: 'DE',
    currencyCode: 'EUR',
    annualThreshold: 22_000,
    thresholdLabel: '22 000 €',
    smallBusinessScheme: 'Kleinunternehmerregelung (§19 UStG)',
  },
  AT: {
    country: 'AT',
    currencyCode: 'EUR',
    annualThreshold: 35_000,
    thresholdLabel: '35 000 €',
    smallBusinessScheme: 'Kleinunternehmerregelung (§6 Abs. 1 Z 27 UStG)',
  },
  PL: {
    country: 'PL',
    currencyCode: 'PLN',
    annualThreshold: 200_000,
    thresholdLabel: '200 000 zł',
    smallBusinessScheme: 'Zwolnienie podmiotowe (Art. 113 ustawy o VAT)',
  },
  NL: {
    country: 'NL',
    currencyCode: 'EUR',
    annualThreshold: 20_000,
    thresholdLabel: '20 000 €',
    smallBusinessScheme: 'Kleineondernemersregeling (KOR)',
  },
  BE: {
    country: 'BE',
    currencyCode: 'EUR',
    annualThreshold: 25_000,
    thresholdLabel: '25 000 €',
    smallBusinessScheme: 'Vrijstellingsregeling kleine ondernemingen',
  },
  FR: {
    country: 'FR',
    currencyCode: 'EUR',
    annualThreshold: 36_800,
    thresholdLabel: '36 800 €',
    smallBusinessScheme: 'Franchise en base de TVA (Art. 293B CGI)',
  },
  UK: {
    country: 'UK',
    currencyCode: 'GBP',
    annualThreshold: 90_000,
    thresholdLabel: '£90 000',
    smallBusinessScheme: 'VAT Registration Threshold (HMRC Notice 700/1)',
  },
  HU: {
    country: 'HU',
    currencyCode: 'HUF',
    annualThreshold: 12_000_000,
    thresholdLabel: '12 000 000 Ft',
    smallBusinessScheme: 'Alanyi adómentesség (2007. évi CXXVII. törvény)',
  },
  HR: {
    country: 'HR',
    currencyCode: 'EUR',
    annualThreshold: 40_000,
    thresholdLabel: '40 000 €',
    smallBusinessScheme: 'Mali porezni obveznik (čl. 90. ZPDVa)',
  },
  IT: {
    country: 'IT',
    currencyCode: 'EUR',
    annualThreshold: 65_000,
    thresholdLabel: '65 000 €',
    smallBusinessScheme: 'Regime forfetario (Legge 190/2014)',
  },
  ES: {
    country: 'ES',
    currencyCode: 'EUR',
    annualThreshold: 0,
    thresholdLabel: 'povinnost od 1. transakce',
    smallBusinessScheme: 'ES: žádná osvobozená prahová hodnota pro fyzické osoby',
  },
  PT: {
    country: 'PT',
    currencyCode: 'EUR',
    annualThreshold: 13_500,
    thresholdLabel: '13 500 €',
    smallBusinessScheme: 'Regime de isenção (Art. 53.º CIVA)',
  },
  RO: {
    country: 'RO',
    currencyCode: 'RON',
    annualThreshold: 300_000,
    thresholdLabel: '300 000 lei',
    smallBusinessScheme: 'Contribuabil mic (art. 310 Cod fiscal)',
  },
};

/** EU OSS cross-border B2C threshold (€10k/year, all EU member states combined). */
export const EU_OSS_THRESHOLD_EUR = 10_000;

export interface ThresholdStatus {
  country: string;
  threshold: VatThreshold | null;
  currentTurnoverMinorUnits: number;
  thresholdMinorUnits: number;
  isExempt: boolean;
  warningPct: number;
  shouldRegister: boolean;
}

/**
 * Determine if a promoter is approaching or over their VAT registration threshold.
 *
 * @param country ISO 2-letter country code
 * @param annualTurnoverMinorUnits Current annual turnover in minor currency units (haléře/grosze/cents)
 * @param vatPayer Whether the promoter is already registered for VAT
 */
export function checkThresholdStatus(
  country: string,
  annualTurnoverMinorUnits: number,
  vatPayer: boolean,
): ThresholdStatus {
  const threshold = VAT_REGISTRATION_THRESHOLDS[country.toUpperCase()] ?? null;

  if (vatPayer || !threshold) {
    return {
      country,
      threshold,
      currentTurnoverMinorUnits: annualTurnoverMinorUnits,
      thresholdMinorUnits: threshold ? threshold.annualThreshold * 100 : 0,
      isExempt: false,
      warningPct: vatPayer ? 100 : 0,
      shouldRegister: false,
    };
  }

  const thresholdMinorUnits = threshold.annualThreshold * 100;
  const warningPct = thresholdMinorUnits > 0
    ? Math.min(100, Math.round((annualTurnoverMinorUnits / thresholdMinorUnits) * 100))
    : 100;
  const shouldRegister = annualTurnoverMinorUnits >= thresholdMinorUnits;

  return {
    country,
    threshold,
    currentTurnoverMinorUnits: annualTurnoverMinorUnits,
    thresholdMinorUnits,
    isExempt: !shouldRegister,
    warningPct,
    shouldRegister,
  };
}

/**
 * OSS note for a promoter.
 * Returns explanation why OSS does or does not apply.
 *
 * For physical and virtual events (post EU Directive 2022/542), VAT is always
 * due in the promoter's country (where the event is deemed to take place),
 * regardless of buyer's country. OSS is N/A for ticketing.
 */
export function getOssNote(isDigitalGoods: boolean): string {
  if (!isDigitalGoods) {
    return 'Vstupenky na akce (fyzické i virtuální) podléhají DPH v zemi pořadatele (čl. 53 Směrnice 2006/112/ES, ve znění Směrnice 2022/542/EU). OSS schéma se nevztahuje.';
  }
  return 'Digitální zboží (stahování, přístupy bez časové vazby na akci) může podléhat OSS — DPH dle země kupce nad prahem 10 000 EUR/rok. Konzultujte daňového poradce.';
}
