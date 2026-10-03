import { describe, it, expect } from 'vitest';
import {
  computeBreakEven,
  summarizeCosts,
  netPerTicketMinor,
  projectResult,
  type BreakEvenInput,
} from './break-even';

/**
 * Kontrolní příklad, který jde spočítat na papíře:
 *   Pevné náklady 100 000 Kč bez DPH, plátce DPH.
 *   Vstupenka 500 Kč včetně 12% DPH → základ 446,43 Kč.
 *   Provize 5 % z HRUBÉ ceny = 25,00 Kč (tak ji strhávají výplaty)
 *   → čistý příjem 446,43 − 25,00 = 421,43 Kč.
 *   Bod zlomu = 10 000 000 ÷ 42 143 = 237,3 → 238 vstupenek (nahoru).
 *   Kontrola: 237 × 42 143 = 9 987 891 < 10 000 000 ≤ 238 × 42 143.
 */
const base: BreakEvenInput = {
  costs: [{ amountMinor: 10_000_000, vatRatePct: 21, isPerAttendee: false }],
  ticketTypes: [{ priceMinor: 50_000, totalQty: 400, soldQty: 0 }],
  ticketVatRatePct: 12,
  platformFeeBps: 500,
  vatPayer: true,
};

describe('netPerTicketMinor', () => {
  it('odečte DPH a naši provizi z hrubé ceny', () => {
    // 500 Kč / 1,12 = 446,43; provize 5 % z 500 Kč = 25,00 → 421,43
    expect(netPerTicketMinor(50_000, 12, 500)).toBe(42_143);
  });

  it('provizi zaokrouhluje dolů jako výplaty (floor)', () => {
    // 99,99 Kč × 5 % = 4,9995 Kč → 499 haléřů, ne 500
    expect(netPerTicketMinor(9_999, 0, 500)).toBe(9_999 - 499);
  });

  it('bez DPH a bez provize vrátí celou cenu', () => {
    expect(netPerTicketMinor(50_000, 0, 0)).toBe(50_000);
  });
});

describe('summarizeCosts', () => {
  it('plátce DPH počítá se základem, neplátce s částkou včetně', () => {
    const costs = [{ amountMinor: 100_000, vatRatePct: 21, isPerAttendee: false }];
    expect(summarizeCosts(costs, true).fixedMinor).toBe(100_000);
    expect(summarizeCosts(costs, false).fixedMinor).toBe(121_000);
  });

  it('odděluje pevné náklady od nákladů na návštěvníka', () => {
    const s = summarizeCosts(
      [
        { amountMinor: 500_000, vatRatePct: 21, isPerAttendee: false },
        { amountMinor: 1_500, vatRatePct: 21, isPerAttendee: true },
      ],
      true,
    );
    expect(s.fixedMinor).toBe(500_000);
    expect(s.perAttendeeMinor).toBe(1_500);
  });
});

describe('computeBreakEven', () => {
  it('spočítá bod zlomu podle kontrolního příkladu', () => {
    const r = computeBreakEven(base);
    expect(r.contributionPerTicketMinor).toBe(42_143);
    expect(r.ticketsNeeded).toBe(238);
    expect(r.ticketsRemaining).toBe(238);
    expect(r.reachable).toBe(true);
  });

  it('odečte už prodané vstupenky ze zbývajících', () => {
    const r = computeBreakEven({
      ...base,
      ticketTypes: [{ priceMinor: 50_000, totalQty: 400, soldQty: 100 }],
    });
    expect(r.ticketsNeeded).toBe(238);
    expect(r.ticketsRemaining).toBe(138);
    expect(r.ticketsSold).toBe(100);
  });

  it('náklad na návštěvníka snižuje příspěvek, ne pevnou část', () => {
    const withPerHead = computeBreakEven({
      ...base,
      costs: [
        { amountMinor: 10_000_000, vatRatePct: 21, isPerAttendee: false },
        { amountMinor: 2_143, vatRatePct: 21, isPerAttendee: true },
      ],
    });
    // Příspěvek klesne o náklad na hlavu → potřeba víc vstupenek.
    expect(withPerHead.contributionPerTicketMinor).toBe(42_143 - 2_143);
    expect(withPerHead.ticketsNeeded).toBe(250);
  });

  it('váží průměr přes cenové hladiny podle zbývající kapacity', () => {
    const r = computeBreakEven({
      ...base,
      ticketTypes: [
        { priceMinor: 100_000, totalQty: 100, soldQty: 0 },
        { priceMinor: 50_000, totalQty: 300, soldQty: 0 },
      ],
    });
    const drahá = netPerTicketMinor(100_000, 12, 500);
    const levná = netPerTicketMinor(50_000, 12, 500);
    const očekáváno = Math.round((drahá * 100 + levná * 300) / 400);
    expect(r.contributionPerTicketMinor).toBe(očekáváno);
  });

  it('pozná, že se akce nezaplatí ani při vyprodání', () => {
    const r = computeBreakEven({
      ...base,
      ticketTypes: [{ priceMinor: 50_000, totalQty: 100, soldQty: 0 }],
    });
    expect(r.reachable).toBe(false);
    expect(r.soldOutResultMinor).toBeLessThan(0);
    expect(r.summary).toContain('nezaplatí');
  });

  it('záporný příspěvek nevrací nekonečno, ale srozumitelné odmítnutí', () => {
    const r = computeBreakEven({
      ...base,
      costs: [
        { amountMinor: 10_000_000, vatRatePct: 21, isPerAttendee: false },
        { amountMinor: 60_000, vatRatePct: 21, isPerAttendee: true },
      ],
    });
    expect(r.ticketsNeeded).toBeNull();
    expect(r.reachable).toBe(false);
    expect(r.summary).toContain('ztrátová');
  });

  it('bez nákladů je bod zlomu nula', () => {
    const r = computeBreakEven({ ...base, costs: [] });
    expect(r.ticketsNeeded).toBe(0);
    expect(r.ticketsRemaining).toBe(0);
    expect(r.coveragePct).toBe(100);
  });

  it('po pokrytí nákladů hlásí zisk z další vstupenky', () => {
    const r = computeBreakEven({
      ...base,
      ticketTypes: [{ priceMinor: 50_000, totalQty: 400, soldQty: 300 }],
    });
    expect(r.ticketsRemaining).toBe(0);
    expect(r.currentResultMinor).toBeGreaterThan(0);
    expect(r.summary).toContain('pokryté');
  });

  it('pokrytí v procentech odpovídá poměru příspěvku k nákladům', () => {
    const r = computeBreakEven({
      ...base,
      ticketTypes: [{ priceMinor: 50_000, totalQty: 400, soldQty: 119 }],
    });
    // 119 × 421,43 = 50 150 Kč z potřebných 100 000 Kč → 50 %
    expect(r.coveragePct).toBe(50);
  });

  it('neplátce DPH má vyšší náklady, a tím i vyšší bod zlomu', () => {
    const plátce = computeBreakEven(base);
    const neplátce = computeBreakEven({ ...base, vatPayer: false });
    expect(neplátce.ticketsNeeded).toBeGreaterThan(plátce.ticketsNeeded ?? 0);
  });
});

describe('projectResult', () => {
  it('vrací výsledek, ne tržbu — při nízkém prodeji zápornou', () => {
    const p = projectResult(base, [
      { label: 'pesimistický', ticketsSold: 100 },
      { label: 'střední', ticketsSold: 238 },
      { label: 'vyprodáno', ticketsSold: 400 },
    ]);
    expect(p[0].resultMinor).toBeLessThan(0);
    expect(p[1].resultMinor).toBeGreaterThanOrEqual(0);
    expect(p[2].resultMinor).toBeGreaterThan(p[1].resultMinor);
  });
});
