import { describe, it, expect } from 'vitest';
import {
  computeArtistSettlement,
  previewByOccupancy,
  bonusMinor,
  percentBaseMinor,
  type DealTerms,
  type EventFinancials,
} from './deal';

/**
 * Modelová akce, na které jdou čísla dopočítat na papíře:
 *   400 míst, prodáno 300, vstupenka 500 Kč včetně 12% DPH.
 *   Tržba 150 000 Kč včetně DPH → základ 133 928,57 Kč.
 *   Pevné náklady 60 000 Kč, náklad na návštěvníka 20 Kč.
 */
const fin: EventFinancials = {
  grossTicketRevenueMinor: 15_000_000,
  ticketVatRatePct: 12,
  ticketsSold: 300,
  ticketsAvailable: 400,
  fixedCostsMinor: 6_000_000,
  perAttendeeCostMinor: 2_000,
};

const percentTerms: DealTerms = {
  royaltyType: 'percent',
  percentRate: 20,
  flatMinor: null,
  perTicketMinor: null,
  minGuaranteeMinor: null,
  capMinor: null,
};

describe('percentBaseMinor', () => {
  it('gross bere cenu včetně DPH', () => {
    expect(percentBaseMinor(fin, 'gross')).toBe(15_000_000);
  });
  it('net_of_vat odečte DPH', () => {
    expect(percentBaseMinor(fin, 'net_of_vat')).toBe(13_392_857);
  });
});

describe('základní typy smluv', () => {
  it('procento z tržby', () => {
    const s = computeArtistSettlement(percentTerms, fin);
    expect(s.feeMinor).toBe(3_000_000); // 20 % ze 150 000 Kč
    expect(s.payableMinor).toBe(3_000_000);
  });

  it('procento ze základu bez DPH je nižší než z ceny včetně', () => {
    const s = computeArtistSettlement({ ...percentTerms, percentBase: 'net_of_vat' }, fin);
    expect(s.feeMinor).toBe(2_678_571); // 20 % z 133 928,57
    expect(s.feeMinor).toBeLessThan(3_000_000);
  });

  it('částka na vstupenku', () => {
    const s = computeArtistSettlement(
      { ...percentTerms, royaltyType: 'per_ticket', percentRate: null, perTicketMinor: 5_000 },
      fin,
    );
    expect(s.feeMinor).toBe(1_500_000); // 300 × 50 Kč
  });

  it('pevná částka nezávisí na prodeji', () => {
    const s = computeArtistSettlement(
      { ...percentTerms, royaltyType: 'flat', percentRate: null, flatMinor: 2_000_000 },
      fin,
    );
    expect(s.feeMinor).toBe(2_000_000);
  });

  it('kombinace pevné částky a procenta se sčítá', () => {
    const s = computeArtistSettlement(
      { ...percentTerms, royaltyType: 'percent_plus_flat', flatMinor: 1_000_000 },
      fin,
    );
    expect(s.feeMinor).toBe(4_000_000); // 1 000 000 + 20 %
  });
});

describe('garance', () => {
  it('garance je spodní hranice, ne příplatek', () => {
    const s = computeArtistSettlement({ ...percentTerms, minGuaranteeMinor: 4_000_000 }, fin);
    expect(s.feeMinor).toBe(4_000_000);
    expect(s.guaranteeApplied).toBe(true);
    // Ne 4 000 000 + 3 000 000.
    expect(s.feeMinor).not.toBe(7_000_000);
  });

  it('když je procento vyšší, garance se neuplatní', () => {
    const s = computeArtistSettlement({ ...percentTerms, minGuaranteeMinor: 1_000_000 }, fin);
    expect(s.feeMinor).toBe(3_000_000);
    expect(s.guaranteeApplied).toBe(false);
  });
});

describe('podíl nad bodem zlomu', () => {
  it('garance plus 70 % z toho, co zbude', () => {
    // Základ bez DPH 133 928,57; náklady 60 000 + 300×20 = 66 000; garance 30 000.
    // Zbývá 133 928,57 − 66 000 − 30 000 = 37 928,57 → 70 % = 26 550
    const s = computeArtistSettlement(
      {
        ...percentTerms,
        royaltyType: 'flat',
        percentRate: null,
        flatMinor: 3_000_000,
        backendPct: 70,
      },
      fin,
    );
    const remainder = 13_392_857 - 6_000_000 - 300 * 2_000 - 3_000_000;
    expect(s.feeMinor).toBe(3_000_000 + Math.round((remainder * 70) / 100));
  });

  it('když se bod zlomu nedosáhne, podíl je nula a řekne se to', () => {
    const s = computeArtistSettlement(
      { ...percentTerms, royaltyType: 'flat', percentRate: null, flatMinor: 3_000_000, backendPct: 70 },
      { ...fin, fixedCostsMinor: 20_000_000 },
    );
    expect(s.feeMinor).toBe(3_000_000);
    const line = s.lines.find((l) => l.key === 'backend');
    expect(line?.amountMinor).toBe(0);
    expect(line?.label).toContain('nebyl dosažen');
  });

  it('náklady zahrnují už přiznanou garanci — pořadatel neplatí dvakrát', () => {
    const bezGarance = computeArtistSettlement(
      { ...percentTerms, royaltyType: 'flat', percentRate: null, flatMinor: 0, backendPct: 50 },
      fin,
    );
    const sGaranci = computeArtistSettlement(
      { ...percentTerms, royaltyType: 'flat', percentRate: null, flatMinor: 1_000_000, backendPct: 50 },
      fin,
    );
    // Garance 10 000 Kč sníží zbytek k dělení o 10 000 → podíl klesne o 5 000.
    expect(sGaranci.feeMinor - bezGarance.feeMinor).toBe(1_000_000 - 500_000);
  });
});

describe('bonusy', () => {
  it('bonus podle počtu vstupenek se přizná při dosažení', () => {
    expect(bonusMinor([{ atTickets: 300, amountMinor: 500_000 }], fin)).toBe(500_000);
    expect(bonusMinor([{ atTickets: 301, amountMinor: 500_000 }], fin)).toBe(0);
  });

  it('bonus podle vyprodanosti', () => {
    // 300/400 = 75 %
    expect(bonusMinor([{ atSelloutPct: 75, amountMinor: 300_000 }], fin)).toBe(300_000);
    expect(bonusMinor([{ atSelloutPct: 76, amountMinor: 300_000 }], fin)).toBe(0);
  });

  it('víc splněných hladin se sčítá', () => {
    const s = computeArtistSettlement(
      {
        ...percentTerms,
        bonusTiers: [
          { atTickets: 100, amountMinor: 100_000 },
          { atTickets: 250, amountMinor: 200_000 },
          { atTickets: 500, amountMinor: 900_000 },
        ],
      },
      fin,
    );
    expect(s.feeMinor).toBe(3_000_000 + 300_000);
  });
});

describe('strop, podíl, záloha a daň', () => {
  it('strop platí na celý honorář včetně bonusů', () => {
    const s = computeArtistSettlement(
      {
        ...percentTerms,
        capMinor: 3_200_000,
        bonusTiers: [{ atTickets: 100, amountMinor: 1_000_000 }],
      },
      fin,
    );
    expect(s.feeMinor).toBe(3_200_000);
    expect(s.capApplied).toBe(true);
  });

  it('podíl při více účinkujících se počítá až z výsledného honoráře', () => {
    const s = computeArtistSettlement({ ...percentTerms, splitPct: 60 }, fin);
    expect(s.feeMinor).toBe(3_000_000);
    expect(s.shareMinor).toBe(1_800_000);
    expect(s.payableMinor).toBe(1_800_000);
  });

  it('záloha se odečte z výplaty, ale nesnižuje honorář', () => {
    const s = computeArtistSettlement({ ...percentTerms, depositMinor: 1_000_000 }, fin);
    expect(s.feeMinor).toBe(3_000_000);
    expect(s.payableMinor).toBe(2_000_000);
  });

  it('záloha vyšší než honorář znamená, že umělec vrací', () => {
    const s = computeArtistSettlement({ ...percentTerms, depositMinor: 4_000_000 }, fin);
    expect(s.payableMinor).toBe(-1_000_000);
  });

  it('srážková daň se počítá z honoráře, ne z částky po odečtu zálohy', () => {
    const s = computeArtistSettlement(
      { ...percentTerms, depositMinor: 1_000_000, withholdingTaxPct: 15 },
      fin,
    );
    expect(s.withholdingTaxMinor).toBe(450_000); // 15 % ze 3 000 000
    expect(s.payableMinor).toBe(3_000_000 - 1_000_000 - 450_000);
  });

  it('řádky výpočtu dávají dohromady výslednou částku', () => {
    const s = computeArtistSettlement(
      {
        ...percentTerms,
        minGuaranteeMinor: 3_500_000,
        bonusTiers: [{ atTickets: 300, amountMinor: 200_000 }],
        depositMinor: 500_000,
        withholdingTaxPct: 15,
      },
      fin,
    );
    const soucet = s.lines.reduce((a, l) => a + l.amountMinor, 0);
    expect(soucet).toBe(s.payableMinor);
  });
});

describe('previewByOccupancy', () => {
  it('ukáže honorář při 30, 50, 70 a 100 procentech', () => {
    const rows = previewByOccupancy(
      { ...percentTerms, minGuaranteeMinor: 2_000_000 },
      {
        ticketVatRatePct: 12,
        ticketsAvailable: 400,
        fixedCostsMinor: 6_000_000,
        perAttendeeCostMinor: 2_000,
      },
      50_000,
    );
    expect(rows).toHaveLength(4);
    expect(rows[0].ticketsSold).toBe(120);
    expect(rows[3].ticketsSold).toBe(400);
    // Při nízkém prodeji drží garance, při vysokém roste procento.
    expect(rows[0].feeMinor).toBe(2_000_000);
    expect(rows[3].feeMinor).toBeGreaterThan(rows[0].feeMinor);
  });

  it('honorář neklesá s rostoucím prodejem', () => {
    const rows = previewByOccupancy(
      percentTerms,
      {
        ticketVatRatePct: 12,
        ticketsAvailable: 400,
        fixedCostsMinor: 6_000_000,
        perAttendeeCostMinor: 2_000,
      },
      50_000,
    );
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].feeMinor).toBeGreaterThanOrEqual(rows[i - 1].feeMinor);
    }
  });
});
