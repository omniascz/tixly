/**
 * Honorář umělce — výpočet podle podmínek, jak se sjednávají v praxi.
 *
 * Doplňuje `compute.ts`, který řeší průběžné načítání podílu po jednotlivých
 * objednávkách. Tenhle modul počítá **konečnou částku po akci**, kde teprve
 * dávají smysl věci, které se během prodeje spočítat nedají: podíl nad bodem
 * zlomu, bonusy za dosažený prodej, odečet zálohy a srážková daň.
 *
 * Pořadí výpočtu — záleží na něm a v branži je ustálené:
 *   1. **Základ podle typu smlouvy** — procento z tržby, částka na vstupenku,
 *      pevná částka, nebo kombinace.
 *   2. **Vyšší z toho a garance.** Garance není příplatek, je to spodní hranice.
 *      Kdo si domluví „5 000 nebo 20 % podle toho, co je vyšší", dostane jedno
 *      z těch dvou, ne obojí.
 *   3. **Podíl nad bodem zlomu** (door split). Přičítá se až nad garancí, a to
 *      z toho, co zbude poté, co pořadatel pokryje náklady *včetně* už
 *      započtené garance. Jinak by pořadatel platil dvakrát.
 *   4. **Bonusy** za dosažený prodej.
 *   5. **Strop** — poslední hranice shora na celý honorář.
 *   6. **Podíl při více účinkujících** — když je honorář společný.
 *   7. **Odečet zálohy** už zaplacené při podpisu.
 *   8. **Srážková daň** u zahraničního umělce: sráží se z honoráře a odvádí ji
 *      pořadatel za umělce.
 *
 * Všechny částky jsou v haléřích (INTEGER), nikdy ve float.
 */

export type PercentBase = 'gross' | 'net_of_vat';

export interface BonusTier {
  /** Bonus se přizná od tohoto počtu prodaných vstupenek. */
  atTickets?: number;
  /** Nebo od tohoto procenta vyprodanosti (0–100). */
  atSelloutPct?: number;
  amountMinor: number;
}

export interface DealTerms {
  royaltyType: 'percent' | 'flat' | 'per_ticket' | 'percent_plus_flat';
  percentRate: number | null;
  flatMinor: number | null;
  perTicketMinor: number | null;
  minGuaranteeMinor: number | null;
  capMinor: number | null;
  /** Záloha zaplacená při podpisu — odečte se na konci. */
  depositMinor?: number;
  /** Podíl (%) z částky, která zbude po pokrytí nákladů včetně garance. */
  backendPct?: number | null;
  bonusTiers?: BonusTier[];
  /** Podíl tohoto umělce na společném honoráři (výchozí 100 %). */
  splitPct?: number;
  /** Z čeho se počítá procento. Výchozí 'gross' = dosavadní chování. */
  percentBase?: PercentBase;
  /** Srážková daň u zdroje v procentech. */
  withholdingTaxPct?: number;
}

/**
 * Podmínky tak, jak leží v `lineups.royalty_agreements` (numeric sloupce
 * přicházejí z `pg` jako řetězce). Sdílí vyúčtování, náhled i bod zlomu,
 * aby se podmínky všude převáděly stejně.
 */
export interface AgreementTermsRow {
  royalty_type: DealTerms['royaltyType'];
  percent_rate: string | null;
  flat_amount_halire: number | null;
  per_ticket_halire: number | null;
  min_guarantee_halire: number | null;
  cap_halire: number | null;
  deposit_minor: number;
  backend_pct: string | null;
  bonus_tiers: BonusTier[] | null;
  split_pct: string;
  percent_base: PercentBase;
  withholding_tax_pct: string;
}

/** SELECT seznam sloupců pro `AgreementTermsRow`. */
export const AGREEMENT_TERMS_COLUMNS = `royalty_type, percent_rate, flat_amount_halire, per_ticket_halire,
  min_guarantee_halire, cap_halire, deposit_minor, backend_pct, bonus_tiers, split_pct,
  percent_base, withholding_tax_pct`;

export function toDealTerms(a: AgreementTermsRow): DealTerms {
  return {
    royaltyType: a.royalty_type,
    percentRate: a.percent_rate === null ? null : Number(a.percent_rate),
    flatMinor: a.flat_amount_halire,
    perTicketMinor: a.per_ticket_halire,
    minGuaranteeMinor: a.min_guarantee_halire,
    capMinor: a.cap_halire,
    depositMinor: a.deposit_minor,
    backendPct: a.backend_pct === null ? null : Number(a.backend_pct),
    bonusTiers: a.bonus_tiers ?? [],
    splitPct: Number(a.split_pct),
    percentBase: a.percent_base,
    withholdingTaxPct: Number(a.withholding_tax_pct),
  };
}

export interface EventFinancials {
  /** Tržba ze vstupenek včetně DPH, v haléřích. */
  grossTicketRevenueMinor: number;
  /** Sazba DPH na vstupném v procentech — pro přepočet na základ. */
  ticketVatRatePct: number;
  ticketsSold: number;
  /** Kapacita v prodeji — pro bonusy vázané na vyprodanost. */
  ticketsAvailable: number;
  /** Pevné náklady akce (haléře) — vstupují do podílu nad bodem zlomu. */
  fixedCostsMinor: number;
  /** Náklady na jednoho návštěvníka (haléře). */
  perAttendeeCostMinor: number;
}

export interface FeeLine {
  key: string;
  label: string;
  amountMinor: number;
}

export interface ArtistSettlement {
  /** Jednotlivé řádky výpočtu v pořadí, v jakém se počítaly. */
  lines: FeeLine[];
  /** Základ podle typu smlouvy před garancí. */
  computedBaseMinor: number;
  /** Honorář po uplatnění garance, podílu nad bodem zlomu, bonusů a stropu. */
  feeMinor: number;
  /** Honorář po uplatnění podílu při více účinkujících. */
  shareMinor: number;
  depositMinor: number;
  withholdingTaxMinor: number;
  /** Kolik se umělci skutečně vyplatí. */
  payableMinor: number;
  /** Zabral strop? */
  capApplied: boolean;
  /** Vyhrála garance nad vypočteným základem? */
  guaranteeApplied: boolean;
}

const round = (n: number): number => Math.round(n);

/** Základ pro procentní podíl podle sjednané dohody. */
export function percentBaseMinor(fin: EventFinancials, base: PercentBase): number {
  if (base === 'net_of_vat') {
    return round(fin.grossTicketRevenueMinor / (1 + fin.ticketVatRatePct / 100));
  }
  return fin.grossTicketRevenueMinor;
}

/** Součet bonusů, na které vznikl nárok. */
export function bonusMinor(tiers: BonusTier[], fin: EventFinancials): number {
  let sum = 0;
  const selloutPct =
    fin.ticketsAvailable > 0 ? (fin.ticketsSold / fin.ticketsAvailable) * 100 : 0;
  for (const t of tiers) {
    const byTickets = t.atTickets !== undefined && fin.ticketsSold >= t.atTickets;
    const byPct = t.atSelloutPct !== undefined && selloutPct >= t.atSelloutPct;
    if (byTickets || byPct) sum += Math.max(0, t.amountMinor);
  }
  return sum;
}

export function computeArtistSettlement(
  terms: DealTerms,
  fin: EventFinancials,
): ArtistSettlement {
  const lines: FeeLine[] = [];
  const pctBase = percentBaseMinor(fin, terms.percentBase ?? 'gross');

  // 1) Základ podle typu smlouvy.
  let computed = 0;
  switch (terms.royaltyType) {
    case 'percent':
      computed = round((pctBase * (terms.percentRate ?? 0)) / 100);
      lines.push({
        key: 'percent',
        label: `${terms.percentRate ?? 0} % z tržby`,
        amountMinor: computed,
      });
      break;
    case 'per_ticket':
      computed = fin.ticketsSold * (terms.perTicketMinor ?? 0);
      lines.push({
        key: 'per_ticket',
        label: `${fin.ticketsSold} × částka na vstupenku`,
        amountMinor: computed,
      });
      break;
    case 'flat':
      computed = terms.flatMinor ?? 0;
      lines.push({ key: 'flat', label: 'Pevná částka', amountMinor: computed });
      break;
    case 'percent_plus_flat': {
      const pct = round((pctBase * (terms.percentRate ?? 0)) / 100);
      const flat = terms.flatMinor ?? 0;
      computed = pct + flat;
      lines.push({ key: 'flat', label: 'Pevná částka', amountMinor: flat });
      lines.push({
        key: 'percent',
        label: `${terms.percentRate ?? 0} % z tržby`,
        amountMinor: pct,
      });
      break;
    }
  }

  // 2) Garance je spodní hranice, ne příplatek.
  let fee = computed;
  let guaranteeApplied = false;
  const guarantee = terms.minGuaranteeMinor ?? 0;
  if (guarantee > 0 && fee < guarantee) {
    lines.push({
      key: 'guarantee',
      label: 'Doplněno do minimální garance',
      amountMinor: guarantee - fee,
    });
    fee = guarantee;
    guaranteeApplied = true;
  }

  // 3) Podíl nad bodem zlomu. Náklady zahrnují i to, co už umělec dostal —
  //    jinak by pořadatel honorář započítal dvakrát.
  const backendPct = terms.backendPct ?? 0;
  if (backendPct > 0) {
    const netRevenue = percentBaseMinor(fin, 'net_of_vat');
    const variableCosts = fin.perAttendeeCostMinor * fin.ticketsSold;
    const remainder = netRevenue - fin.fixedCostsMinor - variableCosts - fee;
    if (remainder > 0) {
      const backend = round((remainder * backendPct) / 100);
      lines.push({
        key: 'backend',
        label: `${backendPct} % z částky nad bodem zlomu`,
        amountMinor: backend,
      });
      fee += backend;
    } else {
      lines.push({
        key: 'backend',
        label: `${backendPct} % nad bodem zlomu — bod zlomu nebyl dosažen`,
        amountMinor: 0,
      });
    }
  }

  // 4) Bonusy za dosažený prodej.
  const bonus = bonusMinor(terms.bonusTiers ?? [], fin);
  if (bonus > 0) {
    lines.push({ key: 'bonus', label: 'Bonus za dosažený prodej', amountMinor: bonus });
    fee += bonus;
  }

  // 5) Strop na celý honorář.
  let capApplied = false;
  if (terms.capMinor !== null && terms.capMinor !== undefined && fee > terms.capMinor) {
    lines.push({ key: 'cap', label: 'Snížení na sjednaný strop', amountMinor: terms.capMinor - fee });
    fee = terms.capMinor;
    capApplied = true;
  }

  // 6) Podíl při více účinkujících.
  const splitPct = terms.splitPct ?? 100;
  const share = splitPct >= 100 ? fee : round((fee * splitPct) / 100);
  if (splitPct < 100) {
    lines.push({ key: 'split', label: `Podíl umělce ${splitPct} %`, amountMinor: share - fee });
  }

  // 7) Záloha zaplacená při podpisu.
  const deposit = Math.max(0, terms.depositMinor ?? 0);
  if (deposit > 0) {
    lines.push({ key: 'deposit', label: 'Odečtena záloha', amountMinor: -deposit });
  }

  // 8) Srážková daň — počítá se z honoráře, ne z částky po odečtu zálohy;
  //    záloha je platba, ne snížení odměny.
  const whPct = terms.withholdingTaxPct ?? 0;
  const withholding = whPct > 0 ? round((share * whPct) / 100) : 0;
  if (withholding > 0) {
    lines.push({
      key: 'withholding',
      label: `Srážková daň ${whPct} %`,
      amountMinor: -withholding,
    });
  }

  const payable = share - deposit - withholding;

  return {
    lines,
    computedBaseMinor: computed,
    feeMinor: fee,
    shareMinor: share,
    depositMinor: deposit,
    withholdingTaxMinor: withholding,
    // Záporná částka znamená, že záloha převýšila honorář — umělec vrací.
    payableMinor: payable,
    capApplied,
    guaranteeApplied,
  };
}

/**
 * Náhled „co umělec dostane při…" pro několik úrovní obsazenosti.
 * Vyjednávací nástroj i kontrola, že podmínky nejsou nesmyslné.
 */
export function previewByOccupancy(
  terms: DealTerms,
  fin: Omit<EventFinancials, 'grossTicketRevenueMinor' | 'ticketsSold'>,
  averageTicketPriceMinor: number,
  occupancyPcts: number[] = [30, 50, 70, 100],
): { occupancyPct: number; ticketsSold: number; payableMinor: number; feeMinor: number }[] {
  return occupancyPcts.map((pct) => {
    const ticketsSold = Math.round((fin.ticketsAvailable * pct) / 100);
    const settlement = computeArtistSettlement(terms, {
      ...fin,
      ticketsSold,
      grossTicketRevenueMinor: ticketsSold * averageTicketPriceMinor,
    });
    return {
      occupancyPct: pct,
      ticketsSold,
      payableMinor: settlement.payableMinor,
      feeMinor: settlement.feeMinor,
    };
  });
}
