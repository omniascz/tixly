#!/usr/bin/env node
/**
 * rls-verify.mjs — deploy gate: porovná ŽIVOU DB proti očekávanému stavu RLS.
 *
 * ── Proč to musí existovat ───────────────────────────────────────────────────
 * `BUNDLE_340-348_prod.sql` byl dosud jediné, co drift RLS vracelo zpět —
 * pouštěl se opakovaně a přepisoval, co se rozešlo. Baseline se aplikuje
 * JEDNOU, takže tahle samoopravná vlastnost zmizí. Bez gate by se drift
 * projevil až tím, že aplikace přestane vidět data (nebo je začne vidět všem).
 *
 * ── Zdroj pravdy ─────────────────────────────────────────────────────────────
 * `rls-snapshot.json`, vygenerovaný z MIGRACÍ (baseline + 453/454/455) na
 * čistém klonu — NE dotazem do produkce. Kdyby se snapshot bral z produkce,
 * gate by porovnával realitu proti realitě a drift by posvětil.
 *
 * ── Co kontroluje ────────────────────────────────────────────────────────────
 *   1. chybějící policy            4. tabulka s RLS a BEZ policy
 *   2. přebývající policy          5. policy na tabulce BEZ zapnutého RLS
 *   3. změněný USING / WITH CHECK  6. role jiná než {public}
 *   7. helpery `app_can_see_user_as_*` musí být SECURITY DEFINER + search_path
 *      (návrat na INVOKER = 128× zpomalení na 21 cestách, FINDINGS §48/§57)
 *
 *   node scripts/rls-verify.mjs --snapshot   # vygeneruje snapshot z klonu
 *   node scripts/rls-verify.mjs              # ověří DATABASE_URL proti snapshotu
 *     --url=<conn>       explicitní connection string
 *     --snapshot-file=<p>
 */
import pg from 'pg';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => {
  const h = argv.find((a) => a.startsWith(`--${n}=`));
  return h ? h.slice(n.length + 3) : d;
};
const SNAP = opt('snapshot-file', new URL('../rls-snapshot.json', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));

const HELPERS = ['app_can_see_user_as_promoter', 'app_can_see_user_as_buyer'];

async function collect(uri) {
  const c = new pg.Client({ connectionString: uri, statement_timeout: 0 });
  await c.connect();
  const policies = (await c.query(`
    SELECT schemaname||'.'||tablename AS tbl, policyname AS pol, cmd,
           permissive, roles::text AS roles,
           coalesce(qual,'') AS qual, coalesce(with_check,'') AS wcheck
    FROM pg_policies ORDER BY 1,2`)).rows;
  const rlsTables = (await c.query(`
    SELECT n.nspname||'.'||cl.relname AS tbl, cl.relrowsecurity AS rls
    FROM pg_class cl JOIN pg_namespace n ON n.oid=cl.relnamespace
    WHERE cl.relkind='r' AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema'
    ORDER BY 1`)).rows;
  const helpers = (await c.query(`
    SELECT p.proname AS nm, p.prosecdef AS secdef,
           coalesce(array_to_string(p.proconfig,','),'') AS cfg
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.proname = ANY($1) ORDER BY 1`, [HELPERS])).rows;
  await c.end();
  return { policies, rlsTables, helpers };
}

const key = (p) => `${p.tbl}|${p.pol}`;

// ── režim snapshot ───────────────────────────────────────────────────────────
if (flag('snapshot')) {
  const uri = opt('url') || process.env.DATABASE_URL;
  if (!uri) { console.error('chybí --url= nebo DATABASE_URL'); process.exit(2); }
  const snap = await collect(uri);
  // Seznam se cte z disku, ne z ruky. Zadratovany retezec tady lhal uz od 455:
  // tvrdil "453 + 454 + 455", zatimco snapshot uz obsahoval i 456-459. Je to
  // tataz trida jako FINDINGS 82 — nastroj, ktery si drzi kopii reality.
  const migDir = new URL('../../migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  const applied = readdirSync(migDir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
  snap.generatedFrom = `migrations: ${applied.join(' + ')}`;
  writeFileSync(SNAP, JSON.stringify(snap, null, 1));
  console.log(`[snapshot] ${snap.policies.length} policies, ` +
    `${snap.rlsTables.filter((t) => t.rls).length} tabulek s RLS, ` +
    `${snap.helpers.length} helperů → ${SNAP}`);
  process.exit(0);
}

// ── režim gate ───────────────────────────────────────────────────────────────
if (!existsSync(SNAP)) { console.error(`❌ snapshot nenalezen: ${SNAP}\n   vygeneruj: node scripts/rls-verify.mjs --snapshot --url=…`); process.exit(2); }
const exp = JSON.parse(readFileSync(SNAP, 'utf8'));
const uri = opt('url') || process.env.DATABASE_URL;
if (!uri) { console.error('chybí --url= nebo DATABASE_URL'); process.exit(2); }
const got = await collect(uri);

const expByKey = new Map(exp.policies.map((p) => [key(p), p]));
const gotByKey = new Map(got.policies.map((p) => [key(p), p]));
const problems = [];
const add = (kind, detail) => problems.push({ kind, detail });

// 1) chybějící  2) přebývající  3) změněný predikát  6) role
for (const [k, e] of expByKey) {
  const g = gotByKey.get(k);
  if (!g) { add('CHYBĚJÍCÍ POLICY', k); continue; }
  if (g.qual !== e.qual) add('ZMĚNĚNÝ USING', `${k}\n      očekáváno: ${e.qual.slice(0, 110)}\n      nalezeno : ${g.qual.slice(0, 110)}`);
  if (g.wcheck !== e.wcheck) add('ZMĚNĚNÝ WITH CHECK', `${k}\n      očekáváno: ${e.wcheck.slice(0, 110)}\n      nalezeno : ${g.wcheck.slice(0, 110)}`);
  if (g.cmd !== e.cmd) add('ZMĚNĚNÝ PŘÍKAZ', `${k}: ${e.cmd} → ${g.cmd}`);
  if (g.permissive !== e.permissive) add('ZMĚNĚNÝ TYP', `${k}: ${e.permissive} → ${g.permissive}`);
}
for (const k of gotByKey.keys()) if (!expByKey.has(k)) add('PŘEBÝVAJÍCÍ POLICY', k);
for (const g of got.policies) if (g.roles !== '{public}') add('ROLE NENÍ {public}', `${key(g)}: ${g.roles}`);

// 4) tabulka s RLS bez policy   5) policy na tabulce bez RLS
const rlsOn = new Set(got.rlsTables.filter((t) => t.rls).map((t) => t.tbl));
const tablesWithPolicy = new Set(got.policies.map((p) => p.tbl));
const expRlsOn = new Set((exp.rlsTables || []).filter((t) => t.rls).map((t) => t.tbl));
for (const t of rlsOn) if (!tablesWithPolicy.has(t)) add('RLS BEZ POLICY (tichý deny)', t);
for (const t of tablesWithPolicy) if (!rlsOn.has(t)) add('POLICY BEZ ENABLE RLS (mrtvá)', t);
for (const t of expRlsOn) if (!rlsOn.has(t)) add('VYPNUTÉ RLS oproti snapshotu', t);

// 7) helpery
for (const nm of HELPERS) {
  const e = (exp.helpers || []).find((h) => h.nm === nm);
  const g = got.helpers.find((h) => h.nm === nm);
  if (!e) continue;
  if (!g) { add('CHYBĚJÍCÍ HELPER', nm); continue; }
  if (!g.secdef) add('HELPER NENÍ SECURITY DEFINER', `${nm} — návrat na INVOKER = 128× zpomalení (FINDINGS §48)`);
  if (!/search_path/.test(g.cfg)) add('HELPER BEZ search_path', `${nm} — SECURITY DEFINER bez search_path lze podstrčit cizí schéma`);
}

console.log('═══ RLS GATE ═══');
console.log(`očekáváno ${exp.policies.length} policies │ nalezeno ${got.policies.length}`);
console.log(`tabulek s RLS: očekáváno ${expRlsOn.size} │ nalezeno ${rlsOn.size}`);
if (!problems.length) { console.log('\n✅ GATE PROŠEL — žádný drift'); process.exit(0); }
const byKind = {};
for (const p of problems) (byKind[p.kind] ??= []).push(p.detail);
console.log(`\n🔴 GATE SELHAL — ${problems.length} rozdílů:\n`);
for (const [k, list] of Object.entries(byKind)) {
  console.log(`  ${k} (${list.length}):`);
  list.slice(0, 12).forEach((d) => console.log(`    • ${d}`));
  if (list.length > 12) console.log(`    … a dalších ${list.length - 12}`);
}
process.exit(1);
