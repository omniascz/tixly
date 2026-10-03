/**
 * Vyúčtování s umělcem — sestavení dokumentu a jeho otisk.
 *
 * Dokument je to, co agent podepíše, takže musí platit dvě věci:
 *   • **Čte se to na jednu stránku.** Kapacita, prodáno, tržba, DPH, náklady,
 *     honorář podle smlouvy, záloha, daň, k výplatě. Nic víc.
 *   • **Otisk je počítaný z čísel, ne z formátování.** Kdyby se hash počítal
 *     z vykresleného textu, změna šablony by zneplatnila staré podpisy.
 */

import { createHash } from 'crypto';
import type { FeeLine } from './deal';

/**
 * Výplaty umělci, které už nejdou vzít zpět. Vyúčtování je odečítá jako
 * „již vyplaceno", aby se honorář nevyplatil dvakrát (průběžně a z vyúčtování).
 */
export const COMMITTED_PAYOUT_STATUSES_SQL = `('approved','processing','paid')`;
export const ALREADY_PAID_LINE_KEY = 'already_paid';

export interface SettlementSnapshot {
  eventTitle: string;
  eventDate: string;
  artistName: string;
  currency: string;
  capacity: number;
  ticketsSold: number;
  grossRevenueMinor: number;
  ticketVatRatePct: number;
  netRevenueMinor: number;
  fixedCostsMinor: number;
  perAttendeeCostMinor: number;
  feeMinor: number;
  shareMinor: number;
  depositMinor: number;
  withholdingMinor: number;
  payableMinor: number;
  lines: FeeLine[];
}

/**
 * Otisk dokumentu. Počítá se z **kanonického zápisu čísel**, ne z HTML —
 * podpis pak přežije změnu šablony, ale ne změnu částky.
 */
export function hashSettlement(s: SettlementSnapshot): string {
  const canonical = JSON.stringify({
    v: 1,
    artist: s.artistName,
    event: s.eventTitle,
    date: s.eventDate,
    currency: s.currency,
    capacity: s.capacity,
    sold: s.ticketsSold,
    gross: s.grossRevenueMinor,
    vat: s.ticketVatRatePct,
    net: s.netRevenueMinor,
    fixed: s.fixedCostsMinor,
    perHead: s.perAttendeeCostMinor,
    fee: s.feeMinor,
    share: s.shareMinor,
    deposit: s.depositMinor,
    withholding: s.withholdingMinor,
    payable: s.payableMinor,
    lines: s.lines.map((l) => [l.key, l.amountMinor]),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function money(minor: number, currency: string): string {
  const v = (minor / 100)
    .toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    // České formátování odděluje tisíce nezlomitelnou mezerou. V prostém textu,
    // který jde e-mailem a do tiskárny, se chová nepředvídatelně — nahrazujeme
    // ji obyčejnou mezerou, aby dokument vypadal všude stejně.
    .replace(/ /g, ' ');
  return `${v} ${currency}`;
}

/**
 * Textová podoba vyúčtování — pro e-mail, tisk i náhled v administraci.
 * Záměrně prostý text: agent ho může přeposlat i vytisknout a nic se nerozbije.
 */
export function renderSettlementText(s: SettlementSnapshot): string {
  const rows: string[] = [];
  rows.push(`VYÚČTOVÁNÍ — ${s.artistName}`);
  rows.push(`${s.eventTitle}, ${s.eventDate}`);
  rows.push('');
  rows.push(`Kapacita:            ${s.capacity} míst`);
  rows.push(`Prodáno:             ${s.ticketsSold} vstupenek`);
  rows.push(`Tržba včetně DPH:    ${money(s.grossRevenueMinor, s.currency)}`);
  rows.push(`DPH ${String(s.ticketVatRatePct).padEnd(3)} %:            ${money(s.grossRevenueMinor - s.netRevenueMinor, s.currency)}`);
  rows.push(`Tržba bez DPH:       ${money(s.netRevenueMinor, s.currency)}`);
  rows.push('');
  rows.push(`Pevné náklady akce:  ${money(s.fixedCostsMinor, s.currency)}`);
  if (s.perAttendeeCostMinor > 0) {
    rows.push(
      `Náklad na návštěvníka: ${money(s.perAttendeeCostMinor, s.currency)} × ${s.ticketsSold} = ${money(s.perAttendeeCostMinor * s.ticketsSold, s.currency)}`,
    );
  }
  rows.push('');
  rows.push('HONORÁŘ PODLE SMLOUVY');
  for (const l of s.lines) {
    rows.push(`  ${l.label.padEnd(38)} ${money(l.amountMinor, s.currency)}`);
  }
  rows.push('');
  rows.push(`K VÝPLATĚ:           ${money(s.payableMinor, s.currency)}`);
  if (s.payableMinor < 0) {
    rows.push('(záporná částka = záloha převýšila honorář, umělec vrací rozdíl)');
  }
  return rows.join('\n');
}
