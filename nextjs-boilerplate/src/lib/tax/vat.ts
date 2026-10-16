/**
 * DPH na dokladech (kolo 7, C-54) — sazby se čtou z DB (platform.vat_rates, migrace 494),
 * v kódu nejsou žádná procenta.
 *
 * ZAOKROUHLENÍ (zdokumentováno a otestováno v vat.test.ts):
 *   Ceny vstupenek jsou koncové (včetně DPH). Podle § 37 odst. 2 zákona o DPH se daň u ceny
 *   včetně daně počítá jako  daň = cena × sazba / (100 + sazba)  a základ = cena − daň.
 *   Počítá se v haléřích (minor units) po SOUČTU řádků téže sazby (ne po kusech), daň se
 *   zaokrouhlí na celé haléře matematicky (0,5 haléře nahoru, od nuly — i pro záporné částky
 *   dobropisu), základ je dopočtený rozdíl. Součet základ + daň proto vždy přesně sedí na cenu.
 */

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

/** Procento sazby `code` platné k datu `date` (YYYY-MM-DD nebo Date); null = sazba neexistuje. */
export async function vatRatePctAt(q: Queryable, code: string, date: string | Date): Promise<number | null> {
  const d = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  const r = await q.query(`SELECT platform.vat_rate_at($1, $2::date) AS pct`, [code, d]);
  const pct = (r.rows[0] as { pct: string | number | null } | undefined)?.pct;
  return pct === null || pct === undefined ? null : Number(pct);
}

/**
 * Daň z ceny včetně DPH přesně v celých číslech: sazba v setinách procenta (12 % → 1200),
 * daň = cena × s / (10000 + s), zaokrouhleno na haléře 0,5 od nuly (symetricky pro dobropisy).
 * BigInt — žádné chyby plovoucí čárky ani u velkých částek.
 */
export function vatFromGrossMinor(grossMinor: number, ratePct: number): number {
  if (!Number.isInteger(grossMinor)) throw new Error('grossMinor musí být celé číslo (haléře)');
  const s = BigInt(Math.round(ratePct * 100));
  if (s === 0n) return 0;
  const g = BigInt(grossMinor);
  const neg = g < 0n;
  const num = (neg ? -g : g) * s;
  const den = 10000n + s;
  const q = (2n * num + den) / (2n * den); // = floor(num/den + 1/2)
  return Number(neg ? -q : q);
}

/** Rozklad ceny včetně DPH (haléře) na základ a daň při dané sazbě. */
export function splitGrossMinor(grossMinor: number, ratePct: number): { baseMinor: number; vatMinor: number } {
  const vatMinor = vatFromGrossMinor(grossMinor, ratePct);
  return { baseMinor: grossMinor - vatMinor, vatMinor };
}

export interface VatLineInput {
  vatRateCode: string;
  ratePct: number;
  grossMinor: number;
}

export interface VatBreakdownLine {
  vatRateCode: string;
  ratePct: number;
  baseMinor: number;
  vatMinor: number;
  totalMinor: number;
}

/** Součty po sazbách: řádky téže sazby se nejdřív sečtou, pak se rozloží (viz hlavička). */
export function breakdownByRate(lines: VatLineInput[]): VatBreakdownLine[] {
  const byCode = new Map<string, { ratePct: number; gross: number }>();
  for (const l of lines) {
    const cur = byCode.get(l.vatRateCode);
    if (cur && cur.ratePct !== l.ratePct) throw new Error(`Kód ${l.vatRateCode} má v jednom dokladu dvě sazby`);
    byCode.set(l.vatRateCode, { ratePct: l.ratePct, gross: (cur?.gross ?? 0) + l.grossMinor });
  }
  return [...byCode.entries()]
    .sort((a, b) => b[1].ratePct - a[1].ratePct)
    .map(([vatRateCode, { ratePct, gross }]) => {
      const { baseMinor, vatMinor } = splitGrossMinor(gross, ratePct);
      return { vatRateCode, ratePct, baseMinor, vatMinor, totalMinor: gross };
    });
}

/** Formát DIČ CZ: „CZ" + 8–10 číslic. */
export function isValidCzDic(dic: string | null | undefined): boolean {
  return !!dic && /^CZ[0-9]{8,10}$/.test(dic.trim());
}
