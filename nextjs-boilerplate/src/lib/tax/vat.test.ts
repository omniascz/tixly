import { describe, expect, it } from 'vitest';
import { breakdownByRate, isValidCzDic, splitGrossMinor, vatFromGrossMinor } from './vat';

/**
 * Zaokrouhlení DPH (kolo 7, C-54): daň = cena × sazba / (100 + sazba), na haléře, 0,5 od nuly,
 * základ = cena − daň (§ 37 odst. 2 ZDPH). Hraniční hodnoty spočítané ručně:
 *   12 %: daň = 3g/28 → přesně ,5 haléře u g = 14 (1,5 → 2); g = 13 → 1,392 → 1; g = 15 → 1,607 → 2.
 *   21 %: daň = 21g/121 → přesné ,5 neexistuje (42g = 121·(2k+1) nemá celočíselné řešení);
 *         g = 2 → 0,347 → 0; g = 3 → 0,521 → 1.
 */
describe('DPH z ceny včetně daně', () => {
  it('12 %: hranice 0,5 haléře se zaokrouhlí nahoru (od nuly)', () => {
    expect(vatFromGrossMinor(13, 12)).toBe(1);
    expect(vatFromGrossMinor(14, 12)).toBe(2);
    expect(vatFromGrossMinor(15, 12)).toBe(2);
    expect(vatFromGrossMinor(112, 12)).toBe(12);
  });

  it('21 %: okolí 0,5 haléře', () => {
    expect(vatFromGrossMinor(2, 21)).toBe(0);
    expect(vatFromGrossMinor(3, 21)).toBe(1);
    expect(vatFromGrossMinor(121, 21)).toBe(21);
  });

  it('dobropis (záporné částky) je symetrický', () => {
    expect(vatFromGrossMinor(-14, 12)).toBe(-2);
    expect(vatFromGrossMinor(-13, 12)).toBe(-1);
    expect(splitGrossMinor(-50000, 12)).toEqual({ baseMinor: -44643, vatMinor: -5357 });
  });

  it('reálná vstupenka 500 Kč při 12 %: daň 53,57 Kč, základ 446,43 Kč', () => {
    expect(splitGrossMinor(50000, 12)).toEqual({ baseMinor: 44643, vatMinor: 5357 });
  });

  it('základ + daň = cena vždy (i velké částky bez chyb plovoucí čárky)', () => {
    for (const g of [1, 7, 99, 12345, 999999, 100_000_000_01, 987_654_321_99]) {
      for (const r of [12, 21]) {
        const { baseMinor, vatMinor } = splitGrossMinor(g, r);
        expect(baseMinor + vatMinor).toBe(g);
      }
    }
    // nezávisle spočteno zlomky v Pythonu: 98765432199 × 21 / 121 = 17141108067.595041 → 17141108068
    expect(vatFromGrossMinor(987_654_321_99, 21)).toBe(17141108068);
  });

  it('0 % sazba: daň 0', () => {
    expect(splitGrossMinor(1234, 0)).toEqual({ baseMinor: 1234, vatMinor: 0 });
  });

  it('rozpis po sazbách sčítá řádky téže sazby PŘED zaokrouhlením', () => {
    // 3 × 0,13 Kč při 12 % po kusech by dalo 3 × 1 = 3 hal.; ze součtu 39 hal. → 39×3/28 = 4,18 → 4
    const b = breakdownByRate([
      { vatRateCode: 'CZ_REDUCED', ratePct: 12, grossMinor: 13 },
      { vatRateCode: 'CZ_REDUCED', ratePct: 12, grossMinor: 13 },
      { vatRateCode: 'CZ_REDUCED', ratePct: 12, grossMinor: 13 },
      { vatRateCode: 'CZ_STANDARD', ratePct: 21, grossMinor: 12100 },
    ]);
    expect(b).toEqual([
      { vatRateCode: 'CZ_STANDARD', ratePct: 21, baseMinor: 10000, vatMinor: 2100, totalMinor: 12100 },
      { vatRateCode: 'CZ_REDUCED', ratePct: 12, baseMinor: 35, vatMinor: 4, totalMinor: 39 },
    ]);
  });

  it('DIČ CZ', () => {
    expect(isValidCzDic('CZ12345678')).toBe(true);
    expect(isValidCzDic('CZ1234567890')).toBe(true);
    expect(isValidCzDic('12345678')).toBe(false);
    expect(isValidCzDic(null)).toBe(false);
  });
});
