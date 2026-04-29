import { describe, expect, it } from 'vitest';
import { parseCnbRates, parseEcbRates } from '../src/lib/rate-parser';

describe('parseCnbRates', () => {
  const sampleCnb = `12.04.2026 #73
země|měna|množství|kód|kurz
Austrálie|dolar|1|AUD|15,432
EMU|euro|1|EUR|25,210
Japonsko|jen|100|JPY|16,841
USA|dolar|1|USD|22,875
Polsko|zlotý|1|PLN|5,892`;

  it('parsuje validni CNB textovy format', () => {
    const rates = parseCnbRates(sampleCnb, '2026-04-12');
    expect(rates).toHaveLength(5);
  });

  it('spravne extrahuje EUR kurz', () => {
    const rates = parseCnbRates(sampleCnb, '2026-04-12');
    const eur = rates.find((r) => r.quote === 'EUR');
    expect(eur).toBeDefined();
    expect(eur!.base).toBe('CZK');
    expect(eur!.quote).toBe('EUR');
    expect(eur!.rate).toBe('25.21000000');
    expect(eur!.source).toBe('CNB');
    expect(eur!.date).toBe('2026-04-12');
  });

  it('spravne deli mnozstvim (JPY/100)', () => {
    const rates = parseCnbRates(sampleCnb, '2026-04-12');
    const jpy = rates.find((r) => r.quote === 'JPY');
    expect(jpy).toBeDefined();
    // 16.841 / 100 = 0.16841
    expect(Number(jpy!.rate).toFixed(5)).toBe('0.16841');
  });

  it('extrahuje PLN kurz', () => {
    const rates = parseCnbRates(sampleCnb, '2026-04-12');
    const pln = rates.find((r) => r.quote === 'PLN');
    expect(pln).toBeDefined();
    expect(pln!.rate).toBe('5.89200000');
  });

  it('vraci prazdne pole pro prazdny vstup', () => {
    expect(parseCnbRates('', '2026-04-12')).toHaveLength(0);
  });

  it('vraci prazdne pole pro vstup pouze s hlavickou', () => {
    const headerOnly = `12.04.2026 #73
země|měna|množství|kód|kurz`;
    expect(parseCnbRates(headerOnly, '2026-04-12')).toHaveLength(0);
  });

  it('preskoci radky s neplatnym formatem', () => {
    const messy = `12.04.2026 #73
země|měna|množství|kód|kurz
EMU|euro|1|EUR|25,210
broken line
|||||`;
    const rates = parseCnbRates(messy, '2026-04-12');
    expect(rates).toHaveLength(1);
    expect(rates[0]!.quote).toBe('EUR');
  });
});

describe('parseEcbRates', () => {
  const sampleEcb = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope>
  <Cube>
    <Cube time='2026-04-12'>
      <Cube currency='USD' rate='1.0842'/>
      <Cube currency='JPY' rate='162.35'/>
      <Cube currency='GBP' rate='0.85670'/>
      <Cube currency='CZK' rate='25.210'/>
      <Cube currency='PLN' rate='4.2830'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

  it('parsuje validni ECB XML', () => {
    const rates = parseEcbRates(sampleEcb, '2026-04-12');
    expect(rates).toHaveLength(5);
  });

  it('spravne extrahuje USD kurz', () => {
    const rates = parseEcbRates(sampleEcb, '2026-04-12');
    const usd = rates.find((r) => r.quote === 'USD');
    expect(usd).toBeDefined();
    expect(usd!.base).toBe('EUR');
    expect(usd!.rate).toBe('1.08420000');
    expect(usd!.source).toBe('ECB');
  });

  it('extrahuje CZK kurz', () => {
    const rates = parseEcbRates(sampleEcb, '2026-04-12');
    const czk = rates.find((r) => r.quote === 'CZK');
    expect(czk).toBeDefined();
    expect(czk!.rate).toBe('25.21000000');
  });

  it('vraci prazdne pole pro XML bez kurzu', () => {
    expect(parseEcbRates('<empty/>', '2026-04-12')).toHaveLength(0);
  });

  it('vraci prazdne pole pro prazdny string', () => {
    expect(parseEcbRates('', '2026-04-12')).toHaveLength(0);
  });
});
