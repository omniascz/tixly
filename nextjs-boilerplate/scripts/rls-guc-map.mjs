#!/usr/bin/env node
/**
 * rls-guc-map.mjs — mapa GUC jmen: co policies ČTOU vs. co aplikace NASTAVUJE.
 *
 * Aplikace (`rls-pool.ts:145-154`) nastavuje 4 jména. Policies jich čtou 11.
 * Rozdíl není kosmetický: predikát na nikdy nenastavené GUC se nemůže stát
 * pravdivým, takže policy jen odepírá — a u přetypovaných tvarů dokonce padá.
 *
 * Hlásí tři věci:
 *   1) kolik policies čte které jméno a jestli ho aplikace nastavuje
 *   2) 🔴 tvar `(current_setting(…))::uuid|::boolean` — prázdný řetězec dá
 *      22P02, tedy 500, NE fail-closed
 *   3) 🟡 tvar porovnání s textem (`= 'true'`) — mrtvé, ale bezpečné
 *
 *   NEON_API_KEY=... node scripts/rls-guc-map.mjs clone.json
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));

// Přesně to, co nastavuje rls-pool.ts:145-154.
const SET_BY_APP = new Set([
  'app.current_promoter_id',
  'app.is_platform_admin',
  'app.current_user_id',
  'app.role',
]);

const c = new pg.Client({ connectionString: clone.ownerUri });
await c.connect();

const pol = (
  await c.query(
    `SELECT schemaname||'.'||tablename tb, policyname, cmd, qual, with_check FROM pg_policies ORDER BY 1,2`,
  )
).rows;
const fns = (
  await c.query(
    `SELECT n.nspname||'.'||p.proname fn, pg_get_functiondef(p.oid) def
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname LIKE 'app\\_%'`,
  )
).rows;
await c.end();

// ── 1) kdo čte co ────────────────────────────────────────────────────────────
const direct = new Map(); // guc → Set(tb|policy)
for (const p of pol) {
  const txt = `${p.qual || ''} ${p.with_check || ''}`;
  for (const m of txt.matchAll(/current_setting\('([a-z_.]+)'/g)) {
    if (!direct.has(m[1])) direct.set(m[1], new Set());
    direct.get(m[1]).add(`${p.tb}|${p.policyname}`);
  }
}
const viaFn = new Map();
for (const f of fns)
  for (const m of f.def.matchAll(/current_setting\('([a-z_.]+)'/g)) {
    if (!viaFn.has(m[1])) viaFn.set(m[1], new Set());
    viaFn.get(m[1]).add(f.fn);
  }

console.log('═══ MAPA GUC ═══');
console.log('jméno                      policies  nastavuje app?  jak se čte');
const all = new Set([...direct.keys(), ...viaFn.keys()]);
const rows = [...all].sort();
for (const g of rows) {
  const n = direct.get(g)?.size ?? 0;
  const via = viaFn.has(g) ? `přes ${[...viaFn.get(g)].join(',')}` : 'přímo v policy';
  const set = SET_BY_APP.has(g) ? '✅ ANO' : '🔴 NE   ';
  console.log(`${g.padEnd(26)} ${String(n).padStart(6)}    ${set}        ${via}`);
}
const orphanTotal = new Set();
for (const g of rows) if (!SET_BY_APP.has(g)) for (const x of direct.get(g) ?? []) orphanTotal.add(x);
console.log(`\nUNIKÁTNÍCH policies čtoucích aspoň jedno NENASTAVOVANÉ jméno: ${orphanTotal.size}`);

// ── 2) nebezpečný tvar: přetypování ──────────────────────────────────────────
console.log('\n═══ 🔴 PŘETYPOVÁNÍ — prázdný řetězec = 22P02, NE fail-closed ═══');
const CAST = /\(\s*current_setting\('([a-z_.]+)'[^)]*\)\s*\)\s*::\s*(uuid|boolean|int[a-z]*)/gi;
const casts = [];
for (const p of pol) {
  const txt = `${p.qual || ''} ${p.with_check || ''}`;
  for (const m of txt.matchAll(CAST)) casts.push({ tb: p.tb, pol: p.policyname, guc: m[1], typ: m[2] });
}
const castOrphan = casts.filter((x) => !SET_BY_APP.has(x.guc));
const castSet = casts.filter((x) => SET_BY_APP.has(x.guc));
console.log(`celkem přetypovaných výskytů: ${casts.length}`);
console.log(`  z toho na NENASTAVOVANÉM jménu : ${castOrphan.length}  (NULL → fail-closed; '' → 22P02)`);
console.log(`  z toho na NASTAVOVANÉM jménu   : ${castSet.length}  (reálné riziko po RESET)`);
const uniq = [...new Map(casts.map((x) => [x.tb + '|' + x.pol + '|' + x.guc, x])).values()];
console.log(`\nunikátních policies s přetypováním: ${new Set(uniq.map((x) => x.tb + '|' + x.pol)).size}`);
uniq.forEach((x) =>
  console.log(`  ${SET_BY_APP.has(x.guc) ? '⚠️ ' : '  '}${x.tb.padEnd(34)} ${x.guc.padEnd(24)}::${x.typ}  (${x.pol})`),
);

// ── 3) bezpečný, ale mrtvý tvar ──────────────────────────────────────────────
console.log('\n═══ 🟡 POROVNÁNÍ S TEXTEM — mrtvé, ale bezpečné ═══');
const TXT = /current_setting\('([a-z_.]+)'[^)]*\)\s*=\s*'([^']*)'/gi;
const txts = [];
for (const p of pol) {
  const t = `${p.qual || ''} ${p.with_check || ''}`;
  for (const m of t.matchAll(TXT)) if (!SET_BY_APP.has(m[1])) txts.push(`${p.tb} ${m[1]}='${m[2]}'`);
}
console.log(`výskytů na nenastavovaném jménu: ${txts.length}`);
[...new Set(txts)].slice(0, 20).forEach((x) => console.log('   ', x));
