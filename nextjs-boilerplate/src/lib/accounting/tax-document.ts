/**
 * Jednotný model daňového dokladu (kolo 7, C-54) — z něj vzniká PDF i ISDOC, ať se nikdy nerozejdou.
 *
 *   docType 'invoice'      daňový doklad (u neplátce prostý doklad bez DPH)
 *   docType 'credit_note'  opravný daňový doklad (dobropis) — záporné částky, odkaz na opravovaný doklad
 *
 * Částky jsou v haléřích (minor units), ceny vstupenek koncové (včetně DPH). Rozpis po sazbách
 * počítá lib/tax/vat.ts (zaokrouhlení zdokumentované tamtéž).
 */
import type { VatBreakdownLine } from '@/lib/tax/vat';

export interface TaxDocAddress {
  street: string;
  city: string;
  zip: string;
  country: string;
}

export interface TaxDocParty {
  name: string;
  ico?: string | null;
  dic?: string | null;
  address?: TaxDocAddress | null;
  email?: string | null;
  bankAccount?: string | null;
}

export interface TaxDocItem {
  description: string;
  quantity: number;
  /** Celkem za řádek včetně DPH (haléře; u dobropisu záporné). */
  totalMinor: number;
  vatRateCode: string | null;
  ratePct: number | null;
}

export interface TaxDocument {
  id: string;
  docType: 'invoice' | 'credit_note';
  number: string;
  issueDate: string;          // YYYY-MM-DD
  taxableSupplyDate: string;  // YYYY-MM-DD (den uskutečnění plnění / přijetí úplaty)
  dueDate: string;            // YYYY-MM-DD
  currency: string;
  supplier: TaxDocParty & { vatPayer: boolean };
  customer: TaxDocParty;
  items: TaxDocItem[];
  /** Rozpis po sazbách — prázdný u neplátce. */
  vatLines: VatBreakdownLine[];
  totalMinor: number;
  correctedDocument?: { id: string; number: string; issueDate: string } | null;
  paid: boolean;
}

/** Text povinný na dokladu neplátce. */
export const NON_PAYER_NOTE = 'Prodávající není plátcem DPH.';

/** Rozparsuje „Ulice 1, Praha 110 00" na části (staré záznamy mají adresu jedním řetězcem). */
export function parseAddress(s: string | null | undefined, country = 'CZ'): TaxDocAddress | null {
  if (!s) return null;
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const m = last.match(/^(\d{3}\s?\d{2})\s+(.+)$/) ?? last.match(/^(.+?)\s+(\d{3}\s?\d{2})$/);
    if (m) {
      const zipFirst = /^\d/.test(m[1]);
      return {
        street: parts.slice(0, -1).join(', '),
        city: (zipFirst ? m[2] : m[1]).trim(),
        zip: (zipFirst ? m[1] : m[2]).replace(/\s/g, ''),
        country,
      };
    }
    return { street: parts.slice(0, -1).join(', '), city: last, zip: '', country };
  }
  return { street: s, city: '', zip: '', country };
}

/**
 * Rozdělí celou částku `total` podle vah metodou největšího zbytku (součet přesně = total).
 * Funguje i pro záporný total (dobropis). Váhy musí být nezáporné a aspoň jedna kladná.
 */
export function allocateProportionally(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) {
    const out = weights.map(() => 0);
    out[0] = total;
    return out;
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / sum);
  const floor = raw.map((r) => Math.floor(r));
  let rest = abs - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    floor[i] += 1;
    rest -= 1;
  }
  return floor.map((v) => sign * v);
}
