#!/usr/bin/env node
/**
 * rls-nested-scan.mjs — které policies vyhodnocují DALŠÍ policy?
 *
 * Nález §48: policy s `EXISTS` nad tabulkou, která má sama zapnuté RLS,
 * spustí pro KAŽDÉHO kandidáta ještě policy té druhé tabulky. Cena pak roste
 * s objemem CIZÍ tabulky, ne s počtem kandidátů. U `identity.users` to dělalo
 * 128×, dokud se helper nepřepnul na SECURITY DEFINER.
 *
 * Tenhle skript hledá tentýž vzor napříč všemi policies — včetně NEPŘÍMÝCH
 * odkazů: policy → funkce → `EXISTS` nad RLS tabulkou. Bez průchodu těly
 * funkcí by `app_can_see_user_as_promoter()` sám vypadal jako neškodný.
 *
 * SECURITY DEFINER funkce se hlásí zvlášť — ty vnořenou policy NEspouštějí,
 * takže jsou už ošetřené.
 *
 *   NEON_API_KEY=... node scripts/rls-nested-scan.mjs clone.json [--json=out]
 */
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const jsonOut = (process.argv.find((a) => a.startsWith('--json=')) || '').split('=')[1];

const c = new pg.Client({ connectionString: clone.ownerUri });
await c.connect();

const pol = (await c.query(`SELECT schemaname sch, tablename tbl, policyname pol, cmd, qual, with_check FROM pg_policies ORDER BY 1,2,3`)).rows;
const fns = (await c.query(`
  SELECT n.nspname||'.'||p.proname AS fqn, p.proname AS nm,
         pg_get_functiondef(p.oid) AS def, p.prosecdef AS secdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema')
    AND p.prokind='f'`)).rows;
const rlsOn = new Set((await c.query(`
  SELECT n.nspname||'.'||cl.relname t FROM pg_class cl
  JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE cl.relrowsecurity`)).rows.map((r) => r.t));
const sizes = Object.fromEntries((await c.query(`
  SELECT n.nspname||'.'||cl.relname t, cl.reltuples::bigint rows FROM pg_class cl
  JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE cl.relkind='r'`)).rows.map((r) => [r.t, Number(r.rows)]));
await c.end();

const fnByName = new Map();
for (const f of fns) { fnByName.set(f.fqn, f); fnByName.set(f.nm, f); }

/** Z výrazu vytáhne tabulky za FROM / JOIN (pg_get_expr je normalizovaný). */
function tablesIn(expr) {
  if (!expr) return [];
  const out = new Set();
  for (const m of expr.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z_0-9]*)\.([a-z_][a-z_0-9]*)/gi))
    out.add(`${m[1]}.${m[2]}`);
  return [...out];
}
/** Jména funkcí volaná ve výrazu. */
function fnsIn(expr) {
  if (!expr) return [];
  const out = new Set();
  for (const m of expr.matchAll(/\b([a-z_][a-z_0-9]*)\.([a-z_][a-z_0-9]*)\s*\(/gi)) out.add(`${m[1]}.${m[2]}`);
  for (const m of expr.matchAll(/\b(app_[a-z_0-9]*)\s*\(/gi)) out.add(m[1]);
  return [...out];
}

/**
 * Rekurzivně: tabulky dosažitelné z výrazu, VČETNĚ přes volané funkce.
 *
 * Do SECURITY DEFINER funkcí se taky vstupuje — jen se jejich zásahy označí
 * `mitigated`, protože vnořenou policy nespustí. Dřívější verze je přeskakovala
 * úplně, takže policy sahající na RLS tabulku VÝHRADNĚ přes funkci nikdy
 * nedorazila do `findings` a čítače o ní strukturálně nemohly vědět.
 */
function reach(expr, depth = 0, seen = new Set(), mitigated = false, via = 'přímo') {
  const out = tablesIn(expr).map((t) => ({ t, via, mitigated }));
  if (depth > 4) return out;
  for (const name of fnsIn(expr)) {
    const f = fnByName.get(name);
    if (!f || seen.has(f.fqn)) continue;
    seen.add(f.fqn);
    const label = via === 'přímo' ? `přes ${f.nm}()` : `${via}→${f.nm}()`;
    for (const r of reach(f.def, depth + 1, seen, mitigated || f.secdef, label)) out.push(r);
  }
  return out;
}

const findings = [];
let viaFnCount = 0, secdefCount = 0;
for (const p of pol) {
  const expr = `${p.qual || ''} ${p.with_check || ''}`;
  const src = `${p.sch}.${p.tbl}`;
  const all = reach(expr).filter((h) => h.t && rlsOn.has(h.t) && h.t !== src);
  if (!all.length) continue;
  // per tabulka: nejlepší případ je „mitigated", ale hlásíme obojí zvlášť
  const live = [...new Map(all.filter((h) => !h.mitigated).map((h) => [h.t, h])).values()];
  const mit = [...new Map(all.filter((h) => h.mitigated).map((h) => [h.t, h])).values()]
    .filter((m) => !live.some((l) => l.t === m.t));
  if (all.some((h) => h.via !== 'přímo')) viaFnCount++;
  if (mit.length) secdefCount++;
  if (!live.length) { // vše ošetřeno SECURITY DEFINER
    findings.push({ src, pol: p.pol, cmd: p.cmd, targets: [], mitigatedTargets: mit.map((m) => ({ t: m.t, via: m.via })), maxRows: 0, risk: 0 });
    continue;
  }
  findings.push({
    src, pol: p.pol, cmd: p.cmd,
    targets: live.map((h) => ({ t: h.t, via: h.via, rows: sizes[h.t] ?? 0 })),
    mitigatedTargets: mit.map((m) => ({ t: m.t, via: m.via })),
    maxRows: Math.max(...live.map((h) => sizes[h.t] ?? 0), 0),
  });
}

// ── riziko: velikost cílové tabulky × kandidáti na zdrojové ─────────────────
const VOLUME = {
  'orders.orders': 5, 'tickets.tickets': 5, 'audit.audit_log': 5,
  'catalog.event_seats': 4, 'catalog.events': 3, 'orders.order_items': 4,
  'identity.users': 3, 'resale.resale_listings': 2, 'platform.promoter_members': 1,
};
const vol = (t) => VOLUME[t] ?? 2;
const live = findings.filter((f) => f.targets.length);
for (const f of live) f.risk = Math.max(...f.targets.map((x) => vol(x.t))) * vol(f.src);
live.sort((a, b) => b.risk - a.risk || a.src.localeCompare(b.src));

const byTarget = {};
for (const f of live) for (const t of f.targets) byTarget[t.t] = (byTarget[t.t] ?? 0) + 1;

console.log('═══ VNOŘENÉ RLS ═══');
console.log(`policies celkem                       : ${pol.length}`);
console.log(`tabulek se zapnutým RLS               : ${rlsOn.size}`);
console.log(`🔴 policies s vnořeným RLS            : ${live.length}  (+ ${findings.length - live.length} plně ošetřených)`);
console.log(`   z toho zásah PŘES FUNKCI           : ${viaFnCount}`);
console.log(`   ošetřeno SECURITY DEFINER          : ${secdefCount}`);
console.log('\nnejčastější CÍLOVÉ tabulky (kolik policies na ně sahá):');
Object.entries(byTarget).sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([t, n]) => console.log(`   ${String(n).padStart(3)}×  ${t}${VOLUME[t] >= 4 ? '   ⚠️ velkoobjemová' : ''}`));

console.log('\n═══ TOP 20 PODLE RIZIKA ═══');
live.slice(0, 20).forEach((f, i) =>
  console.log(`${String(i + 1).padStart(3)}. ${f.src}.${f.pol} [${f.cmd}]\n      → ${f.targets.map((t) => `${t.t} (${t.via})`).join(', ')}`));

if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ total: pol.length, nested: findings.length, byTarget, findings }, null, 2));
