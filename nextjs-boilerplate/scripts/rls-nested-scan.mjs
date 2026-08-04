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

/** Rekurzivně: tabulky dosažitelné z výrazu, včetně přes funkce. */
function reach(expr, depth = 0, seen = new Set()) {
  const direct = tablesIn(expr).map((t) => ({ t, via: 'přímo' }));
  if (depth > 3) return direct;
  const out = [...direct];
  for (const name of fnsIn(expr)) {
    const f = fnByName.get(name);
    if (!f || seen.has(f.fqn)) continue;
    seen.add(f.fqn);
    if (f.secdef) { out.push({ t: null, secdef: f.fqn }); continue; } // neprovádí vnořenou policy
    for (const r of reach(f.def, depth + 1, seen)) out.push({ ...r, via: `přes ${f.nm}()` });
  }
  return out;
}

const findings = [];
for (const p of pol) {
  const expr = `${p.qual || ''} ${p.with_check || ''}`;
  const src = `${p.sch}.${p.tbl}`;
  const hits = reach(expr).filter((h) => h.t && rlsOn.has(h.t) && h.t !== src);
  const secdefs = reach(expr).filter((h) => h.secdef).map((h) => h.secdef);
  if (!hits.length) continue;
  const uniq = [...new Map(hits.map((h) => [h.t, h])).values()];
  findings.push({
    src, pol: p.pol, cmd: p.cmd,
    targets: uniq.map((h) => ({ t: h.t, via: h.via, rows: sizes[h.t] ?? 0 })),
    secdefs: [...new Set(secdefs)],
    maxRows: Math.max(...uniq.map((h) => sizes[h.t] ?? 0), 0),
  });
}

// ── riziko: velikost cílové tabulky × kandidáti na zdrojové ─────────────────
const VOLUME = {
  'orders.orders': 5, 'tickets.tickets': 5, 'audit.audit_log': 5,
  'catalog.event_seats': 4, 'catalog.events': 3, 'orders.order_items': 4,
  'identity.users': 3, 'resale.resale_listings': 2, 'platform.promoter_members': 1,
};
const vol = (t) => VOLUME[t] ?? 2;
for (const f of findings) f.risk = Math.max(...f.targets.map((x) => vol(x.t))) * vol(f.src);
findings.sort((a, b) => b.risk - a.risk || a.src.localeCompare(b.src));

const byTarget = {};
for (const f of findings) for (const t of f.targets) byTarget[t.t] = (byTarget[t.t] ?? 0) + 1;

console.log('═══ VNOŘENÉ RLS ═══');
console.log(`policies celkem                       : ${pol.length}`);
console.log(`tabulek se zapnutým RLS               : ${rlsOn.size}`);
console.log(`🔴 policies s vnořeným RLS            : ${findings.length}`);
console.log(`   z toho přes funkci (nepřímo)       : ${findings.filter((f) => f.targets.some((t) => t.via !== 'přímo')).length}`);
console.log(`   policies volající SECURITY DEFINER : ${findings.filter((f) => f.secdefs.length).length}`);
console.log('\nnejčastější CÍLOVÉ tabulky (kolik policies na ně sahá):');
Object.entries(byTarget).sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([t, n]) => console.log(`   ${String(n).padStart(3)}×  ${t}${VOLUME[t] >= 4 ? '   ⚠️ velkoobjemová' : ''}`));

console.log('\n═══ TOP 20 PODLE RIZIKA ═══');
findings.slice(0, 20).forEach((f, i) =>
  console.log(`${String(i + 1).padStart(3)}. ${f.src}.${f.pol} [${f.cmd}]\n      → ${f.targets.map((t) => `${t.t} (${t.via})`).join(', ')}`));

if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ total: pol.length, nested: findings.length, byTarget, findings }, null, 2));
