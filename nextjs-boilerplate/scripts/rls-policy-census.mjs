#!/usr/bin/env node
/**
 * rls-policy-census.mjs — sčítání a roztřídění RLS policies podle TVARU predikátu.
 *
 * ── Proč podle tvaru ─────────────────────────────────────────────────────────
 * 596 policies není 596 různých pravidel. Drtivá většina je tentýž vzorec
 * („promoter_id = current_setting('app.current_promoter_id')") opsaný nad jinou
 * tabulkou. Testovat 596× totéž nemá cenu — testovat se musí každý VZOREC.
 *
 * Normalizace: z predikátu se vyhodí názvy tabulek/sloupců a literály, zůstane
 * kostra (jaké GUC čte, jaké operátory, jestli má poddotaz). Dvě policies se
 * stejnou kostrou spadnou do stejného vzorce.
 *
 * ── Co hlásí zvlášť (kandidáti na dekoraci) ──────────────────────────────────
 *   • policy na tabulce BEZ `ENABLE ROW LEVEL SECURITY` → nikdy se nevyhodnotí
 *   • `USING (true)` bez WITH CHECK → nefiltruje nic
 *   • policy pro roli, která neexistuje / nepoužívá se
 *
 *   NEON_API_KEY=... node scripts/rls-policy-census.mjs clone.json [--json=out]
 */
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const jsonOut = (process.argv.find((a) => a.startsWith('--json=')) || '').split('=')[1];

const c = new pg.Client({ connectionString: clone.ownerUri });
await c.connect();

const pol = (
  await c.query(`
  SELECT p.schemaname, p.tablename, p.policyname, p.permissive,
         p.roles::text AS roles, p.cmd, p.qual, p.with_check,
         cl.relrowsecurity AS rls_on, cl.relforcerowsecurity AS rls_forced
  FROM pg_policies p
  JOIN pg_class cl ON cl.relname = p.tablename
  JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = p.schemaname
  ORDER BY 1,2,3`)
).rows;

// tabulky s RLS zapnutým, ale BEZ jediné policy → default deny
const rlsNoPolicy = (
  await c.query(`
  SELECT n.nspname||'.'||cl.relname t FROM pg_class cl
  JOIN pg_namespace n ON n.oid=cl.relnamespace
  WHERE cl.relrowsecurity AND NOT EXISTS (
    SELECT 1 FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=cl.relname)
  ORDER BY 1`)
).rows.map((r) => r.t);

const tablesRlsOn = (await c.query(`SELECT count(*)::int n FROM pg_class WHERE relrowsecurity`))
  .rows[0].n;
await c.end();

/** Z predikátu udělá kostru: pryč s názvy a literály, zůstanou GUC a operátory. */
function shape(expr) {
  if (expr == null) return '∅';
  let s = expr.toLowerCase();
  s = s.replace(/current_setting\('([a-z_.]+)'[^)]*\)/g, "GUC[$1]");
  s = s.replace(/'[^']*'/g, "'L'"); // literály
  s = s.replace(/\b\d+\b/g, 'N');
  s = s.replace(/\(select[^;]*?\bfrom\b\s+([a-z_]+\.?[a-z_]*)/g, '(SUBQ from $1');
  s = s.replace(/\b(?!and\b|or\b|not\b|true\b|false\b|null\b|exists\b|in\b|is\b|any\b|all\b|select\b|from\b|where\b|case\b|when\b|then\b|else\b|end\b|guc\b|subq\b|n\b|l\b)[a-z_][a-z_0-9]*\.?[a-z_0-9]*\b/g, 'X');
  s = s.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
  return s;
}

const patterns = new Map();
for (const p of pol) {
  const key = `${p.cmd} | USING ${shape(p.qual)} | CHECK ${shape(p.with_check)}`;
  if (!patterns.has(key))
    patterns.set(key, { key, cmd: p.cmd, count: 0, tables: [], sampleQual: p.qual, sampleCheck: p.with_check, rlsOff: 0 });
  const e = patterns.get(key);
  e.count++;
  if (e.tables.length < 60) e.tables.push(`${p.schemaname}.${p.tablename}`);
  if (!p.rls_on) e.rlsOff++;
}

const sorted = [...patterns.values()].sort((a, b) => b.count - a.count);
const polRlsOff = pol.filter((p) => !p.rls_on);
const usingTrue = pol.filter((p) => (p.qual || '').trim() === 'true');
const noQualNoCheck = pol.filter((p) => p.qual == null && p.with_check == null);
const gucs = new Set();
for (const p of pol)
  for (const m of `${p.qual || ''} ${p.with_check || ''}`.matchAll(/current_setting\('([a-z_.]+)'/g))
    gucs.add(m[1]);

console.log(`═══ SČÍTÁNÍ RLS ═══`);
console.log(`policies celkem            : ${pol.length}`);
console.log(`tabulek s ENABLE RLS       : ${tablesRlsOn}`);
console.log(`DISTINKTNÍCH VZORCŮ        : ${sorted.length}`);
console.log(`GUC použité v predikátech  : ${[...gucs].sort().join(', ') || '(žádné)'}`);
console.log('');
console.log(`🔴 policies na tabulce BEZ ENABLE RLS : ${polRlsOff.length}`);
if (polRlsOff.length) {
  const t = [...new Set(polRlsOff.map((p) => `${p.schemaname}.${p.tablename}`))];
  console.log(`   dotčených tabulek: ${t.length}`);
  t.slice(0, 40).forEach((x) => console.log('     ', x));
}
console.log(`🟡 USING (true)                       : ${usingTrue.length}`);
console.log(`🟡 bez USING i bez WITH CHECK         : ${noQualNoCheck.length}`);
console.log(`🟢 ENABLE RLS bez jediné policy (deny): ${rlsNoPolicy.length}`);
rlsNoPolicy.slice(0, 20).forEach((x) => console.log('     ', x));

console.log(`\n═══ VZORCE (${sorted.length}) ═══`);
sorted.forEach((p, i) => {
  console.log(`\n[${i + 1}] ×${p.count}  cmd=${p.cmd}${p.rlsOff ? `  ⚠️ ${p.rlsOff}× na tabulce bez ENABLE RLS` : ''}`);
  console.log(`    USING : ${(p.sampleQual ?? '∅').slice(0, 200)}`);
  console.log(`    CHECK : ${(p.sampleCheck ?? '∅').slice(0, 200)}`);
  console.log(`    např. : ${p.tables.slice(0, 3).join(', ')}`);
});

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ total: pol.length, tablesRlsOn, patterns: sorted, polRlsOff, usingTrue, rlsNoPolicy, policies: pol }, null, 2));
  console.log(`\n[census] JSON → ${jsonOut}`);
}
