import { describe, it, expect } from 'vitest';
import { hashSettlement, renderSettlementText, type SettlementSnapshot } from './settlement-doc';

const snap: SettlementSnapshot = {
  eventTitle: 'Koncert v Lucerně',
  eventDate: '2026-11-14',
  artistName: 'Kapela X',
  currency: 'CZK',
  capacity: 400,
  ticketsSold: 300,
  grossRevenueMinor: 15_000_000,
  ticketVatRatePct: 12,
  netRevenueMinor: 13_392_857,
  fixedCostsMinor: 6_000_000,
  perAttendeeCostMinor: 2_000,
  feeMinor: 3_000_000,
  shareMinor: 3_000_000,
  depositMinor: 500_000,
  withholdingMinor: 0,
  payableMinor: 2_500_000,
  lines: [
    { key: 'percent', label: '20 % z tržby', amountMinor: 3_000_000 },
    { key: 'deposit', label: 'Odečtena záloha', amountMinor: -500_000 },
  ],
};

describe('hashSettlement', () => {
  it('stejná čísla dají stejný otisk', () => {
    expect(hashSettlement(snap)).toBe(hashSettlement({ ...snap }));
  });

  it('změna částky změní otisk', () => {
    expect(hashSettlement({ ...snap, payableMinor: 2_500_001 })).not.toBe(hashSettlement(snap));
  });

  it('změna popisku řádku otisk NEzmění — podpis přežije úpravu šablony', () => {
    const jiny = {
      ...snap,
      lines: [
        { key: 'percent', label: 'Podíl 20 % z tržby', amountMinor: 3_000_000 },
        { key: 'deposit', label: 'Odečtena záloha', amountMinor: -500_000 },
      ],
    };
    expect(hashSettlement(jiny)).toBe(hashSettlement(snap));
  });

  it('změna částky v řádku otisk změní', () => {
    const jiny = {
      ...snap,
      lines: [
        { key: 'percent', label: '20 % z tržby', amountMinor: 3_100_000 },
        { key: 'deposit', label: 'Odečtena záloha', amountMinor: -500_000 },
      ],
    };
    expect(hashSettlement(jiny)).not.toBe(hashSettlement(snap));
  });
});

describe('renderSettlementText', () => {
  const text = renderSettlementText(snap);

  it('obsahuje jméno umělce i akci', () => {
    expect(text).toContain('Kapela X');
    expect(text).toContain('Koncert v Lucerně');
  });

  it('ukazuje prodej, tržbu i DPH', () => {
    expect(text).toContain('300 vstupenek');
    expect(text).toContain('150 000,00 CZK');
    // DPH = 150 000 − 133 928,57
    expect(text).toContain('16 071,43 CZK');
  });

  it('vypíše rozpad honoráře a konečnou částku', () => {
    expect(text).toContain('20 % z tržby');
    expect(text).toContain('Odečtena záloha');
    expect(text).toContain('K VÝPLATĚ');
    expect(text).toContain('25 000,00 CZK');
  });

  it('u záporné částky vysvětlí, že umělec vrací', () => {
    const t = renderSettlementText({ ...snap, payableMinor: -100_000 });
    expect(t).toContain('umělec vrací');
  });
});
