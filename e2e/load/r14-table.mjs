/**
 * Kolo 14 / krok 2 — tabulka z k6 --summary-export: krok | p50 | p95 | p99 | chybovost (5xx / síť / neočekávaný kód)
 * + řízená 503 a konzistence. node load/r14-table.mjs <štítek> [<štítek> …]  (soubory logs/r14/load/summary_<štítek>.json)
 */
import { existsSync, readFileSync } from 'node:fs';

const DIR = new URL('../../logs/r14/load/', import.meta.url);
const STEPS = ['page', 'plan', 'hold', 'checkout', 'pay', 'webhook'];
const ms = (v) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
for (const label of process.argv.slice(2)) {
  const m = JSON.parse(readFileSync(new URL(`summary_${label}.json`, DIR), 'utf8')).metrics;
  const c = (k) => m[k]?.count ?? 0;
  const consF = new URL(`consistency_${label}.json`, DIR);
  const cons = existsSync(consF) ? JSON.parse(readFileSync(consF, 'utf8')) : null;
  console.log(`\n### ${label}\n\n| krok | p50 | p95 | p99 | požadavků | chyby | řízené 503 (opakováno / i po opakování) |\n|---|---|---|---|---|---|---|`);
  for (const s of STEPS) {
    const t = m[`t_${s}`] ?? {};
    const n = t.count ?? 0;
    const err = c(`err_${s}`);
    console.log(`| ${s} | ${ms(t['p(50)'])} | ${ms(t['p(95)'])} | ${ms(t['p(99)'])} | ${n} | ${err} (${n ? ((100 * err) / n).toFixed(1) : '0.0'} %) | ${c(`s503_${s}`)} / ${c(`s503final_${s}`)} |`);
  }
  console.log(`\nprodáno míst ${c('bought_seats')}, kolize holdu (409) ${c('hold_conflict')}, vyprodáno ${c('sold_out')}, opakování sítě testu ${c('harness_retry_pay')}`);
  if (cons) console.log(`konzistence: ${cons.ok ? 'OK' : 'CHYBA'} — prodaná místa ${cons.after.soldSeats}, zaplacené položky ${cons.after.paidItems}, vstupenky ${cons.after.ticketsOnPaid}, místo 2× ${cons.after.seatInTwoPaidItems}/${cons.after.seatInTwoTickets}, osiřelé holdy ${cons.after.heldSeats}, pending po expiraci ${cons.after.pendingOrders}`);
}
