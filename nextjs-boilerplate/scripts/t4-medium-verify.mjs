#!/usr/bin/env node
/**
 * t4-medium-verify.mjs — overi 15 nalezu T4 medium proti REALNEMU katalogu
 * a dohleda, kde ta data ve skutecnosti jsou.
 *
 * Metoda „hledej SLOUPCE, ne jmena" — tataz, ktera zabrala u `seat_assignments`
 * (§166: sedadlo je na `tickets.tickets.seat_id`) a u group_discounts.
 *
 * SELF-CHECK: kontrola musi oznacit jako EXISTUJICI sloupec, o kterem to vime
 * (`platform.promoters.id`), a jako CHYBEJICI vymysleny. Jinak exit 3.
 *
 *   node scripts/t4-medium-verify.mjs <uri>
 */
import pg from 'pg';

const URI = process.argv[2];
if (!URI) { console.error('pouziti: <uri>'); process.exit(2); }
const pool = new pg.Pool({ connectionString: URI, max: 3 });

/** 15 nalezu T4 medium ze §201 (schema.tabulka, sloupec, kde se cte). */
const NALEZY = [
  ['orders.reschedule_responses', 'user_id', 'admin/events/[id]/reschedule/stats:64 + reschedule/[token]:106'],
  ['platform.promoters', 'payout_currency', 'admin/payouts/execute:48 + lib/payouts/executor.ts:283'],
  ['platform.promoters', 'wise_recipient_id', 'admin/payouts/execute:48 + lib/payouts/executor.ts:283'],
  ['platform.promoters', 'paypal_payout_email', 'admin/payouts/execute:48 + lib/payouts/executor.ts:283'],
  ['tickets.cross_pass_memberships', 'membership_code', 'buyer/cross-passes/my-memberships:19'],
  ['tickets.cross_pass_memberships', 'valid_until', 'buyer/cross-passes/my-memberships:19'],
  ['catalog.events', 'name', 'press/event/[id]:23'],
  ['catalog.events', 'starts_at', 'reviews/[token]:24'],
  ['marketing.event_reviews', 'reviewer_name', 'reviews/[token]:24'],
  ['marketing.event_reviews', 'review_token', 'reviews/[token]:24 + :69'],
];

const { rows: allCols } = await pool.query(`
  SELECT table_schema s, table_name t, column_name c, data_type d
  FROM information_schema.columns
  WHERE table_schema NOT IN ('pg_catalog','information_schema')`);
const mapa = new Map();
for (const r of allCols) {
  const k = `${r.s}.${r.t}`;
  if (!mapa.has(k)) mapa.set(k, new Map());
  mapa.get(k).set(r.c, r.d);
}
const existuje = (tab, col) => mapa.get(tab)?.has(col) ?? false;

// SELF-CHECK
if (!existuje('platform.promoters', 'id') || existuje('platform.promoters', 'tenhle_sloupec_neexistuje_xyz')) {
  console.error('SELF-CHECK SELHAL -> cisla NEPLATI.');
  await pool.end();
  process.exit(3);
}
console.log('SELF-CHECK OK: znamy sloupec nalezen, vymysleny ne.\n');

console.log('── OVERENI 15 NALEZU T4 MEDIUM ──');
let skutecnych = 0, fp = 0;
for (const [tab, col, kde] of NALEZY) {
  const tabExists = mapa.has(tab);
  const e = existuje(tab, col);
  if (e) fp++; else if (tabExists) skutecnych++;
  console.log(`  ${e ? 'FALSE POSITIVE' : tabExists ? 'SKUTECNY     ' : 'TABULKA CHYBI'}  ${tab}.${col}`);
  console.log(`      ${kde}`);
}
console.log(`\nskutecnych: ${skutecnych}   false positive: ${fp}`);

console.log('\n── platform.promoters: co tam OPRAVDU je ──');
console.log('  ' + [...(mapa.get('platform.promoters') ?? new Map()).keys()].join(', '));

console.log('\n── kde jsou payout data doopravdy (hledam SLOUPCE, ne jmena) ──');
for (const vzor of ['currency', 'wise', 'paypal', 'payout', 'iban', 'bank']) {
  const hits = allCols
    .filter((r) => r.c.includes(vzor))
    .map((r) => `${r.s}.${r.t}.${r.c}`);
  console.log(`  *${vzor}*: ${hits.length ? hits.slice(0, 12).join(', ') : '(nic)'}`);
}

console.log('\n── catalog.events / marketing.event_reviews / cross_pass_memberships ──');
for (const t of ['catalog.events', 'marketing.event_reviews', 'tickets.cross_pass_memberships', 'orders.reschedule_responses']) {
  const cols = mapa.get(t);
  console.log(`  ${t}: ${cols ? [...cols.keys()].join(', ') : 'TABULKA NEEXISTUJE'}`);
}

await pool.end();
