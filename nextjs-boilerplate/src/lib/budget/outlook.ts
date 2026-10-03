/**
 * Bod zlomu a výhled výsledku VČETNĚ honorářů umělců.
 *
 * `break-even.ts` počítá jen s položkami rozpočtu. Honorář ale u většiny akcí
 * v rozpočtu jako pevná položka není — procento z tržby nebo podíl nad bodem
 * zlomu dopředu číslo nemá. Bez něj stránka hlásila „náklady jsou pokryté"
 * u akce, kde kapela bere 70 % tržby. Tenhle modul honorář dopočítá týmž
 * výpočtem, jaký použije vyúčtování (`computeArtistSettlement`), takže výhled
 * a pozdější vyúčtování se nerozejdou.
 *
 * Položka rozpočtu navázaná na smlouvu (vzniká přijetím nabídky — garance)
 * se při výpočtu NEPOČÍTÁ jako náklad: honorář té smlouvy se dopočítá celý
 * a garance je v něm obsažená. Jinak by se garance odečetla dvakrát.
 *
 * Model prodeje je stejný jako v `computeBreakEven`: N vstupenek s váženým
 * průměrem cen podle zbývající kapacity.
 */

import { computeArtistSettlement, type DealTerms } from '@/lib/royalties/deal';
import {
  computeBreakEven,
  projectResult,
  saleWeights,
  type BreakEvenInput,
  type BreakEvenResult,
  type CostItem,
} from './break-even';

export interface LinkedCostItem extends CostItem {
  /** Smlouva s umělcem, ze které položka vznikla (garance z přijaté nabídky). */
  agreementId?: string | null;
}

export interface ArtistDealInput {
  agreementId: string;
  terms: DealTerms;
}

export interface OutlookInput extends Omit<BreakEvenInput, 'costs'> {
  costs: LinkedCostItem[];
  deals: ArtistDealInput[];
}

export interface OutlookBreakEven extends BreakEvenResult {
  /** Honoráře umělců při současném prodeji. */
  artistFeesCurrentMinor: number;
  /** Honoráře umělců při vyprodání. */
  artistFeesSoldOutMinor: number;
  /** Počet započtených smluv s umělci. */
  dealCount: number;
}

export interface OutlookScenario {
  label: string;
  ticketsSold: number;
  resultMinor: number;
  artistFeesMinor: number;
}

/** Nejdál, kam se bod zlomu hledá, když ho nejde dosáhnout v kapacitě. */
const SEARCH_LIMIT_FACTOR = 5;
const SEARCH_LIMIT_MIN = 10_000;

export function computeOutlook(
  input: OutlookInput,
  scenarios: { label: string; ticketsSold: number }[],
): { breakEven: OutlookBreakEven; scenarios: OutlookScenario[] } {
  const dealIds = new Set(input.deals.map((d) => d.agreementId));
  const baseInput: BreakEvenInput = {
    ...input,
    costs: input.costs.filter((c) => !c.agreementId || !dealIds.has(c.agreementId)),
  };
  const base = computeBreakEven(baseInput);
  const baseScenarios = projectResult(baseInput, scenarios);

  if (input.deals.length === 0) {
    return {
      breakEven: { ...base, artistFeesCurrentMinor: 0, artistFeesSoldOutMinor: 0, dealCount: 0 },
      scenarios: baseScenarios.map((s) => ({ ...s, artistFeesMinor: 0 })),
    };
  }

  const capacity = base.ticketsAvailable;

  // Náklady, které vidí výpočet podílu nad bodem zlomu u KAŽDÉ smlouvy —
  // stejně jako ve vyúčtování: všechny položky kromě vlastní garance, v základu
  // bez DPH.
  const perHeadMinor = input.costs
    .filter((c) => c.isPerAttendee)
    .reduce((s, c) => s + Math.max(0, Math.round(c.amountMinor)), 0);
  const fixedFor = (agreementId: string) =>
    input.costs
      .filter((c) => !c.isPerAttendee && c.agreementId !== agreementId)
      .reduce((s, c) => s + Math.max(0, Math.round(c.amountMinor)), 0);
  const dealFixed = input.deals.map((d) => fixedFor(d.agreementId));

  const fees = (grossMinor: number, sold: number): number =>
    input.deals.reduce(
      (sum, d, i) =>
        sum +
        computeArtistSettlement(d.terms, {
          grossTicketRevenueMinor: Math.max(0, Math.round(grossMinor)),
          ticketVatRatePct: input.ticketVatRatePct,
          ticketsSold: Math.max(0, sold),
          ticketsAvailable: capacity,
          fixedCostsMinor: dealFixed[i],
          perAttendeeCostMinor: perHeadMinor,
        }).shareMinor,
      0,
    );

  // Průměrná hrubá cena se stejnými vahami jako příspěvek.
  const weights = saleWeights(input.ticketTypes);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const avgGrossMinor =
    totalWeight > 0
      ? input.ticketTypes.reduce((s, t, i) => s + t.priceMinor * weights[i], 0) / totalWeight
      : 0;

  const contribution = base.contributionPerTicketMinor;
  const resultAt = (n: number) =>
    Math.round(contribution * n) - base.costs.fixedMinor - fees(avgGrossMinor * n, n);

  const actualGross = input.ticketTypes.reduce((s, t) => s + t.priceMinor * Math.max(0, t.soldQty), 0);
  const soldOutGross = input.ticketTypes.reduce((s, t) => s + t.priceMinor * Math.max(0, t.totalQty), 0);
  const feesCurrent = fees(actualGross, base.ticketsSold);
  const feesSoldOut = fees(soldOutGross, capacity);
  const currentResultMinor = base.currentResultMinor - feesCurrent;
  const soldOutResultMinor = base.soldOutResultMinor - feesSoldOut;

  const realizedContribution = base.currentResultMinor + base.costs.fixedMinor;
  const toCover = base.costs.fixedMinor + feesCurrent;
  const coveragePct =
    toCover > 0 ? Math.max(0, Math.round((realizedContribution / toCover) * 100)) : 100;

  let ticketsNeeded: number | null = null;
  if (contribution > 0) {
    const limit = Math.max(capacity * SEARCH_LIMIT_FACTOR, SEARCH_LIMIT_MIN);
    for (let n = 0; n <= limit; n++) {
      if (resultAt(n) >= 0) {
        ticketsNeeded = n;
        break;
      }
    }
  }
  const ticketsRemaining =
    ticketsNeeded === null ? null : Math.max(0, ticketsNeeded - base.ticketsSold);
  const reachable = ticketsNeeded !== null && ticketsNeeded <= capacity;

  const feesNote = `honoráře umělců ${(feesCurrent / 100).toFixed(0)} Kč při současném prodeji`;
  let summary: string;
  if (ticketsNeeded === null) {
    summary = `Ani po prodeji všech vstupenek nepokryje příspěvek náklady a honoráře (${feesNote}). Akce je při těchto podmínkách ztrátová.`;
  } else if (ticketsRemaining === 0) {
    const atN = Math.max(base.ticketsSold, ticketsNeeded);
    const marginal = resultAt(atN + 1) - resultAt(atN);
    summary = `Náklady i honoráře jsou pokryté. Každá další vstupenka přidá zhruba ${(marginal / 100).toFixed(0)} Kč k zisku.`;
  } else if (!reachable) {
    summary = `K pokrytí nákladů a honorářů by bylo potřeba ${ticketsNeeded} vstupenek, ale v prodeji je jich jen ${capacity}. Akce se při současném rozpočtu nezaplatí.`;
  } else {
    summary = `Do pokrytí nákladů a honorářů zbývá prodat ${ticketsRemaining} vstupenek z ${capacity - base.ticketsSold} dostupných (${feesNote}).`;
  }

  return {
    breakEven: {
      ...base,
      ticketsNeeded,
      ticketsRemaining,
      coveragePct,
      reachable,
      currentResultMinor,
      soldOutResultMinor,
      summary,
      artistFeesCurrentMinor: feesCurrent,
      artistFeesSoldOutMinor: feesSoldOut,
      dealCount: input.deals.length,
    },
    scenarios: baseScenarios.map((s) => {
      const f = fees(avgGrossMinor * s.ticketsSold, s.ticketsSold);
      return { ...s, resultMinor: s.resultMinor - f, artistFeesMinor: f };
    }),
  };
}
