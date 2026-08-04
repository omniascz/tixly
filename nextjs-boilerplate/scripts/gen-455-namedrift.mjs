#!/usr/bin/env node
/**
 * gen-455-namedrift.mjs — vygeneruje migraci 455 z reálného katalogu.
 *
 * Píše DDL pro policies, které čtou GUC jména, jež aplikace NIKDY nenastavuje
 * (FINDINGS §38), a převádí je na kanonické `app_*()` helpery z migrace 285.
 *
 * ── ⚠️ Převádí se JEN jména identity ─────────────────────────────────────────
 *   app.promoter_id → app_current_promoter_id()
 *   app.user_id     → app_current_user_id()
 *
 * NEPŘEVÁDÍ se `app.bypass_rls`, `app.use_service_role`, `app.is_service`,
 * `app.is_admin`, `app.platform_admin`. Všechno to jsou příznaky ZVÝŠENÍ
 * OPRÁVNĚNÍ, ne identity. Dnes jsou mrtvé (nikdo je nenastaví), takže větev
 * nikdy nesedí. Kdybychom je napojili na `app_is_service()` /
 * `app_is_platform_admin()`, AKTIVOVALI bychom dosud mrtvou větev — tedy
 * rozšířili přístup. To je jiné rozhodnutí než oprava name-driftu a patří
 * mu vlastní migrace s vlastním měřením.
 *
 * Rozdíl je v ohraničení: převod jména identity vrací přístup k VLASTNÍM datem
 * (omezeno tenantem), převod příznaku oprávnění dává plošný bypass.
 *
 *   NEON_API_KEY=... node scripts/gen-455-namedrift.mjs clone.json > ../migrations/455_....sql
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const c = new pg.Client({ connectionString: clone.ownerUri });
await c.connect();

const pol = (
  await c.query(`
  SELECT schemaname sch, tablename tbl, policyname pol, permissive perm,
         roles::text[] roles, cmd, qual, with_check
  FROM pg_policies
  WHERE coalesce(qual,'')||coalesce(with_check,'') LIKE '%app.promoter_id%'
     OR coalesce(qual,'')||coalesce(with_check,'') LIKE '%app.user_id%'
  ORDER BY 1,2,3`)
).rows;
await c.end();

/** Textová náhrada: nejdřív tvar s přetypováním, pak holý (textový kontext). */
function convert(expr) {
  if (!expr) return null;
  let s = expr;
  for (const [guc, fn] of [
    ['app.promoter_id', 'public.app_current_promoter_id()'],
    ['app.user_id', 'public.app_current_user_id()'],
  ]) {
    const g = guc.replace('.', '\\.');
    // (current_setting('app.x'::text, true))::uuid  → fn()
    s = s.replace(new RegExp(`\\(\\s*current_setting\\('${g}'::text,\\s*true\\)\\s*\\)::uuid`, 'gi'), fn);
    s = s.replace(new RegExp(`current_setting\\('${g}'::text,\\s*true\\)::uuid`, 'gi'), fn);
    // holý current_setting v textovém porovnání → (fn())::text
    s = s.replace(new RegExp(`current_setting\\('${g}'::text,\\s*true\\)`, 'gi'), `(${fn})::text`);
  }
  return s;
}

const out = [];
out.push('--');
out.push('-- 455_rls_namedrift_identity.sql — name-drift GUC → kanonické app_*() helpery');
out.push('--');
out.push('-- Policies čtou GUC jména, která `rls-pool.ts` NIKDY nenastavuje (FINDINGS §38).');
out.push('-- Predikát se proto nemůže stát pravdivým a policy jen odepírá — 6 z 12 tabulek,');
out.push('-- kde aplikace nevidí ani vlastní data, sedí přesně na tenhle rozpor (§34).');
out.push('--');
out.push('-- Převádí se JEN jména IDENTITY:');
out.push('--   app.promoter_id → public.app_current_promoter_id()');
out.push('--   app.user_id     → public.app_current_user_id()');
out.push('--');
out.push('-- ⚠️ NEPŘEVÁDÍ se `app.bypass_rls`, `app.use_service_role`, `app.is_service`,');
out.push('--    `app.is_admin`, `app.platform_admin`. To jsou příznaky ZVÝŠENÍ OPRÁVNĚNÍ,');
out.push('--    ne identity. Dnes jsou mrtvé; napojit je na app_is_service() /');
out.push('--    app_is_platform_admin() by AKTIVOVALO dosud mrtvou větev, tedy rozšířilo');
out.push('--    přístup. Jiné rozhodnutí, jiná migrace, vlastní měření.');
out.push('--');
out.push('-- Rozdíl je v ohraničení: jméno identity vrací přístup k VLASTNÍM datům');
out.push('-- (omezeno tenantem), příznak oprávnění dává plošný bypass.');
out.push('--');
out.push('-- Helpery navíc dělají NULLIF(current_setting(…),\'\')::uuid, takže tahle');
out.push('-- migrace zároveň odstraňuje přímé casty → past 22P02 (§39).');
out.push('--');
out.push(`-- Vygenerováno scripts/gen-455-namedrift.mjs — ${pol.length} policies.`);
out.push('--');
out.push('-- NENASAZENO NA PRODUKCI.');
out.push('--');
out.push('');
out.push('BEGIN;');
out.push('');

let converted = 0;
for (const p of pol) {
  const q = convert(p.qual);
  const w = convert(p.with_check);
  if (q === p.qual && w === p.with_check) {
    out.push(`-- ⚠️ ${p.sch}.${p.tbl} / ${p.pol}: náhrada se netrefila, PŘESKOČENO`);
    continue;
  }
  converted++;
  const tbl = `"${p.sch}"."${p.tbl}"`;
  const roles = p.roles.filter((r) => r !== 'public');
  out.push(`-- ── ${p.sch}.${p.tbl} :: ${p.pol} ──`);
  out.push(`DROP POLICY IF EXISTS "${p.pol}" ON ${tbl};`);
  let stmt = `CREATE POLICY "${p.pol}" ON ${tbl}`;
  if (p.perm !== 'PERMISSIVE') stmt += ` AS RESTRICTIVE`;
  if (p.cmd && p.cmd !== 'ALL') stmt += ` FOR ${p.cmd}`;
  if (roles.length) stmt += ` TO ${roles.map((r) => `"${r}"`).join(', ')}`;
  if (q) stmt += `\n  USING (${q})`;
  if (w) stmt += `\n  WITH CHECK (${w})`;
  out.push(stmt + ';');
  out.push('');
}
out.push('COMMIT;');
console.error(`[gen] policies nalezeno: ${pol.length}, převedeno: ${converted}`);
console.log(out.join('\n'));
