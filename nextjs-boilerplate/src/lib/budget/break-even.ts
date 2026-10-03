/**
 * Rozpočet akce a bod zlomu.
 *
 * Odpovídá na otázku, kterou si promotér klade každý den: **kolik vstupenek
 * ještě musím prodat, aby akce nebyla ztrátová.** Čisté funkce bez databáze —
 * stejný výpočet používá přehled akce, denní snímek i výhled zisku.
 *
 * Co do výpočtu vstupuje a proč:
 *   • **Pevné náklady** (pronájem, technika, honorář) se dělí mezi prodané
 *     vstupenky. To je čitatel zlomku.
 *   • **Náklady na návštěvníka** (náramek, odbavení) snižují příspěvek každé
 *     vstupenky, nezvyšují pevnou část. Míchat je dohromady je nejčastější
 *     chyba v tabulkových rozpočtech a vede k bodu zlomu, který nesedí.
 *   • **DPH** není příjem promotéra. U plátce se počítá ze základu, u neplátce
 *     je daň nákladem a počítá se z ceny včetně.
 *   • **Naše provize** se strhává z hrubé ceny (jako u výplat) a snižuje příspěvek.
 *   • **Honoráře umělců** tady NEJSOU — přidává je `outlook.ts`.
 *
 * Vzorec: bod zlomu = pevné náklady ÷ (čistý příspěvek jedné vstupenky).
 * Když je příspěvek nulový nebo záporný, bod zlomu neexistuje — akce se
 * nezaplatí ani při vyprodání a je potřeba to říct, ne vrátit nekonečno.
 */

export interface CostItem {
  /** Základ bez DPH v haléřích. U položky na návštěvníka je to částka za jednoho. */
  amountMinor: number;
  vatRatePct: number;
  isPerAttendee: boolean;
}

export interface TicketTypeSales {
  /** Cena vstupenky včetně DPH v haléřích. */
  priceMinor: number;
  /** Kolik kusů je v prodeji celkem. */
  totalQty: number;
  /** Kolik už je prodáno. */
  soldQty: number;
}

export interface BreakEvenInput {
  costs: CostItem[];
  ticketTypes: TicketTypeSales[];
  /** Sazba DPH na vstupném v procentech (CZ kultura = 12). */
  ticketVatRatePct: number;
  /** Naše provize v setinách procenta: 500 = 5,00 %. */
  platformFeeBps: number;
  /**
   * Je promotér plátce DPH? Plátce si daň na vstupu odečte, takže nákladem je
   * základ. Neplátci je daň nákladem a počítá se s částkou včetně.
   */
  vatPayer: boolean;
}

export interface CostSummary {
  /** Pevné náklady celkem (podle režimu DPH). */
  fixedMinor: number;
  /** Náklad na jednoho návštěvníka. */
  perAttendeeMinor: number;
  /** DPH na vstupu z pevných nákladů — u plátce vratná, u neplátce už započtená. */
  fixedVatMinor: number;
}

export interface BreakEvenResult {
  costs: CostSummary;
  /** Vážený průměrný příspěvek jedné vstupenky po DPH, provizi a nákladu na návštěvníka. */
  contributionPerTicketMinor: number;
  /** Kolik vstupenek je potřeba prodat celkem. null = nelze dosáhnout. */
  ticketsNeeded: number | null;
  /** Kolik ještě zbývá prodat. null = nelze dosáhnout, 0 = už je pokryto. */
  ticketsRemaining: number | null;
  /** Kolik už je prodáno. */
  ticketsSold: number;
  /** Kolik je celková kapacita v prodeji. */
  ticketsAvailable: number;
  /** Podíl pokrytí nákladů v procentech (0–100+). */
  coveragePct: number;
  /** Je bod zlomu v dosahu kapacity? */
  reachable: boolean;
  /** Odhad výsledku při současném prodeji (může být záporný). */
  currentResultMinor: number;
  /** Odhad výsledku při vyprodání. */
  soldOutResultMinor: number;
  /** Lidsky čitelné shrnutí. */
  summary: string;
}

/** Rozdělí náklady na pevné a na návštěvníka podle režimu DPH. */
export function summarizeCosts(costs: CostItem[], vatPayer: boolean): CostSummary {
  let fixed = 0;
  let perAttendee = 0;
  let fixedVat = 0;

  for (const c of costs) {
    const base = Math.max(0, Math.round(c.amountMinor));
    const vat = Math.round((base * c.vatRatePct) / 100);
    // Plátce DPH má nákladem základ, neplátce částku včetně daně.
    const effective = vatPayer ? base : base + vat;
    if (c.isPerAttendee) {
      perAttendee += effective;
    } else {
      fixed += effective;
      fixedVat += vat;
    }
  }

  return { fixedMinor: fixed, perAttendeeMinor: perAttendee, fixedVatMinor: fixedVat };
}

/**
 * Čistý příjem promotéra z jedné vstupenky: bez DPH a bez naší provize.
 *
 * Provize se počítá z HRUBÉ ceny a zaokrouhluje dolů — přesně tak, jak ji
 * strhávají výplaty (`admin/payouts`, `cron/event-payout-release`:
 * `floor(gross × bps / 10000)`). Ze základu bez DPH by bod zlomu vycházel
 * příznivěji, než kolik pořadatel opravdu dostane.
 */
export function netPerTicketMinor(
  priceMinor: number,
  ticketVatRatePct: number,
  platformFeeBps: number,
): number {
  const base = Math.round(priceMinor / (1 + ticketVatRatePct / 100));
  const commission = Math.floor((priceMinor * platformFeeBps) / 10_000);
  return base - commission;
}

/**
 * Váhy cenových hladin pro průměr: podle **zbývající kapacity**, protože bod
 * zlomu je otázka do budoucna — zajímá nás, co přinesou vstupenky, které ještě
 * půjde prodat. Když je vyprodáno, váží se podle prodaných.
 */
export function saleWeights(ticketTypes: TicketTypeSales[]): number[] {
  const remainingWeights = ticketTypes.map((t) => Math.max(0, t.totalQty - t.soldQty));
  const totalRemaining = remainingWeights.reduce((a, b) => a + b, 0);
  return totalRemaining > 0 ? remainingWeights : ticketTypes.map((t) => Math.max(0, t.soldQty));
}

function weightedContribution(input: BreakEvenInput, perAttendeeMinor: number): number {
  const weights = saleWeights(input.ticketTypes);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return 0;

  let sum = 0;
  for (let i = 0; i < input.ticketTypes.length; i++) {
    const net = netPerTicketMinor(
      input.ticketTypes[i].priceMinor,
      input.ticketVatRatePct,
      input.platformFeeBps,
    );
    sum += (net - perAttendeeMinor) * weights[i];
  }
  return Math.round(sum / totalWeight);
}

export function computeBreakEven(input: BreakEvenInput): BreakEvenResult {
  const costs = summarizeCosts(input.costs, input.vatPayer);
  const ticketsSold = input.ticketTypes.reduce((a, t) => a + Math.max(0, t.soldQty), 0);
  const ticketsAvailable = input.ticketTypes.reduce((a, t) => a + Math.max(0, t.totalQty), 0);

  const contribution = weightedContribution(input, costs.perAttendeeMinor);

  // Skutečný příspěvek z už prodaných vstupenek — pro výsledek se počítá
  // s cenami typů, které se reálně prodaly.
  let realizedContribution = 0;
  for (const t of input.ticketTypes) {
    const net = netPerTicketMinor(t.priceMinor, input.ticketVatRatePct, input.platformFeeBps);
    realizedContribution += (net - costs.perAttendeeMinor) * Math.max(0, t.soldQty);
  }
  let soldOutContribution = 0;
  for (const t of input.ticketTypes) {
    const net = netPerTicketMinor(t.priceMinor, input.ticketVatRatePct, input.platformFeeBps);
    soldOutContribution += (net - costs.perAttendeeMinor) * Math.max(0, t.totalQty);
  }

  const currentResultMinor = realizedContribution - costs.fixedMinor;
  const soldOutResultMinor = soldOutContribution - costs.fixedMinor;

  if (costs.fixedMinor === 0) {
    return {
      costs,
      contributionPerTicketMinor: contribution,
      ticketsNeeded: 0,
      ticketsRemaining: 0,
      ticketsSold,
      ticketsAvailable,
      coveragePct: 100,
      reachable: true,
      currentResultMinor,
      soldOutResultMinor,
      summary: 'Akce nemá zadané pevné náklady — bod zlomu je nula.',
    };
  }

  if (contribution <= 0) {
    return {
      costs,
      contributionPerTicketMinor: contribution,
      ticketsNeeded: null,
      ticketsRemaining: null,
      ticketsSold,
      ticketsAvailable,
      coveragePct: costs.fixedMinor > 0 ? Math.max(0, Math.round((realizedContribution / costs.fixedMinor) * 100)) : 0,
      reachable: false,
      currentResultMinor,
      soldOutResultMinor,
      summary:
        'Každá prodaná vstupenka je po odečtení nákladů na návštěvníka ztrátová — bod zlomu nelze dosáhnout ani při vyprodání.',
    };
  }

  const ticketsNeeded = Math.ceil(costs.fixedMinor / contribution);
  const ticketsRemaining = Math.max(0, ticketsNeeded - ticketsSold);
  const coveragePct = Math.max(0, Math.round((realizedContribution / costs.fixedMinor) * 100));
  const reachable = ticketsNeeded <= ticketsAvailable;

  let summary: string;
  if (ticketsRemaining === 0) {
    summary = `Náklady jsou pokryté. Každá další vstupenka přidá ${(contribution / 100).toFixed(0)} Kč k zisku.`;
  } else if (!reachable) {
    summary = `K pokrytí nákladů by bylo potřeba ${ticketsNeeded} vstupenek, ale v prodeji je jich jen ${ticketsAvailable}. Akce se při současném rozpočtu nezaplatí.`;
  } else {
    summary = `Do pokrytí nákladů zbývá prodat ${ticketsRemaining} vstupenek z ${ticketsAvailable - ticketsSold} dostupných.`;
  }

  return {
    costs,
    contributionPerTicketMinor: contribution,
    ticketsNeeded,
    ticketsRemaining,
    ticketsSold,
    ticketsAvailable,
    coveragePct,
    reachable,
    currentResultMinor,
    soldOutResultMinor,
    summary,
  };
}

/**
 * Odhad výsledku (ne tržby) pro tři scénáře prodeje. Nahrazuje samotný výhled
 * tržby, který promotérovi neřekne, jestli na akci vydělá.
 */
export function projectResult(
  input: BreakEvenInput,
  scenarios: { label: string; ticketsSold: number }[],
): { label: string; ticketsSold: number; resultMinor: number }[] {
  const costs = summarizeCosts(input.costs, input.vatPayer);
  const contribution = weightedContribution(input, costs.perAttendeeMinor);
  return scenarios.map((s) => ({
    label: s.label,
    ticketsSold: s.ticketsSold,
    resultMinor: Math.round(contribution * Math.max(0, s.ticketsSold)) - costs.fixedMinor,
  }));
}
