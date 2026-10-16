import { describe, it, expect } from 'vitest';
import type { DealTerms } from '@/lib/royalties/deal';
import { computeBreakEven } from './break-even';
import { computeOutlook, type OutlookInput } from './outlook';

/**
 * Základ jako v break-even.test.ts: pevné náklady 100 000 Kč, vstupenka 500 Kč
 * vč. 12 % DPH, provize 5 % z hrubé → příspěvek 421,43 Kč, kapacita 400.
 * Bez honoráře: bod zlomu 238.
 */
const base: OutlookInput = {
  costs: [{ amountMinor: 10_000_000, vatRatePct: 21, isPerAttendee: false }],
  ticketTypes: [{ priceMinor: 50_000, totalQty: 400, soldQty: 0 }],
  ticketVatRatePct: 12,
  platformFeeBps: 500,
  vatPayer: true,
  deals: [],
};

const flat = (minor: number): DealTerms => ({
  royaltyType: 'flat',
  percentRate: null,
  flatMinor: minor,
  perTicketMinor: null,
  minGuaranteeMinor: null,
  capMinor: null,
});

const percent = (pct: number, guaranteeMinor: number | null = null): DealTerms => ({
  royaltyType: 'percent',
  percentRate: pct,
  flatMinor: null,
  perTicketMinor: null,
  minGuaranteeMinor: guaranteeMinor,
  capMinor: null,
});

const scen = [{ label: 'vyprodáno', ticketsSold: 400 }];

describe('computeOutlook', () => {
  it('bez smluv vrací totéž co computeBreakEven', () => {
    const o = computeOutlook(base, scen);
    const b = computeBreakEven(base);
    expect(o.breakEven.ticketsNeeded).toBe(b.ticketsNeeded);
    expect(o.breakEven.currentResultMinor).toBe(b.currentResultMinor);
    expect(o.breakEven.dealCount).toBe(0);
    expect(o.scenarios[0].artistFeesMinor).toBe(0);
  });

  it('pevný honorář 50 000 Kč se chová jako pevný náklad', () => {
    // (10 000 000 + 5 000 000) / 42 143 = 355,9 → 356
    const o = computeOutlook({ ...base, deals: [{ agreementId: 'A', terms: flat(5_000_000) }] }, scen);
    expect(o.breakEven.ticketsNeeded).toBe(356);
    expect(o.breakEven.reachable).toBe(true);
    // vyprodáno: 42 143 × 400 − 10 000 000 − 5 000 000 = 1 857 200
    expect(o.scenarios[0].resultMinor).toBe(1_857_200);
    expect(o.scenarios[0].artistFeesMinor).toBe(5_000_000);
  });

  it('garance z přijaté nabídky v rozpočtu se nezapočte dvakrát', () => {
    const o = computeOutlook(
      {
        ...base,
        costs: [
          ...base.costs,
          { amountMinor: 5_000_000, vatRatePct: 0, isPerAttendee: false, agreementId: 'A' },
        ],
        deals: [{ agreementId: 'A', terms: flat(5_000_000) }],
      },
      scen,
    );
    expect(o.breakEven.ticketsNeeded).toBe(356);
    expect(o.breakEven.costs.fixedMinor).toBe(10_000_000);
  });

  it('položka navázaná na smlouvu, která už není aktivní, zůstává nákladem', () => {
    const o = computeOutlook(
      {
        ...base,
        costs: [
          ...base.costs,
          { amountMinor: 5_000_000, vatRatePct: 0, isPerAttendee: false, agreementId: 'ZRUSENA' },
        ],
      },
      scen,
    );
    expect(o.breakEven.costs.fixedMinor).toBe(15_000_000);
    expect(o.breakEven.ticketsNeeded).toBe(356);
  });

  it('50 % z hrubé tržby sníží příspěvek a bod zlomu se nevejde do kapacity', () => {
    // příspěvek 42 143 − 25 000 = 17 143; 10 000 000 / 17 143 = 583,3 → 584 > 400
    const o = computeOutlook({ ...base, deals: [{ agreementId: 'A', terms: percent(50) }] }, scen);
    expect(o.breakEven.ticketsNeeded).toBe(584);
    expect(o.breakEven.reachable).toBe(false);
    expect(o.breakEven.summary).toContain('nezaplatí');
  });

  it('garance nebo procento podle toho, co je vyšší', () => {
    // 20 % z 500 Kč = 100 Kč/vst., garance 20 000 Kč.
    // n < 200: 42 143n − 12 000 000 ≥ 0 → n ≥ 285 — mimo interval.
    // n ≥ 200: 32 143n ≥ 10 000 000 → n ≥ 311,1 → 312.
    const o = computeOutlook(
      { ...base, deals: [{ agreementId: 'A', terms: percent(20, 2_000_000) }] },
      scen,
    );
    expect(o.breakEven.ticketsNeeded).toBe(312);
  });

  it('výsledek teď odečte honorář ze skutečné tržby', () => {
    // prodáno 100 → tržba 5 000 000; 20 % = 1 000 000
    // 42 143 × 100 − 10 000 000 − 1 000 000 = −6 785 700
    const o = computeOutlook(
      {
        ...base,
        ticketTypes: [{ priceMinor: 50_000, totalQty: 400, soldQty: 100 }],
        deals: [{ agreementId: 'A', terms: percent(20) }],
      },
      scen,
    );
    expect(o.breakEven.artistFeesCurrentMinor).toBe(1_000_000);
    expect(o.breakEven.currentResultMinor).toBe(-6_785_700);
    expect(o.breakEven.ticketsRemaining).toBe(o.breakEven.ticketsNeeded! - 100);
  });

  it('honorář vyšší než příspěvek — bod zlomu neexistuje ani mimo kapacitu', () => {
    const o = computeOutlook({ ...base, deals: [{ agreementId: 'A', terms: percent(100) }] }, scen);
    expect(o.breakEven.ticketsNeeded).toBeNull();
    expect(o.breakEven.reachable).toBe(false);
    expect(o.breakEven.summary).toContain('ztrátová');
  });
});
