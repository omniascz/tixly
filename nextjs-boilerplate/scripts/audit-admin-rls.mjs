/**
 * AUDIT — admin/platform read cesty pod ENFORCED RLS ("admin tail", Fáze 2).
 *
 * Proč: buyer golden-path + public read jsou ověřené. Zbývá authed admin plocha
 * (/api/admin = promotér, /api/platform = master admin). Pod NOBYPASSRLS rolí
 * tabulka s RLS=on a BEZ policy pro privilegovaný kontext vrátí 0 řádků =
 * tichý lockout admin UI. Tenhle skript to najde DŘÍV než staging.
 *
 * Metoda: vytáhne tabulky čtené v /api/admin + /api/platform a pro každou
 * porovná počet řádků pod 3 kontexty (tixly_rls_test, NOBYPASSRLS):
 *   - service  (app.role=system)            → ground truth (app_is_service)
 *   - admin    (app.is_platform_admin=true) → master admin /platform
 *   - promoter (app.current_promoter_id=X)  → promotér /admin (vidí svůj subset)
 *
 * Nález = service>0 & admin=0 & promoter=0 & RLS=on → deny-by-default lockout.
 *
 * Spuštění: node scripts/audit-admin-rls.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const cs = (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1];

// Reálné seed identity (z DB): promotér se 4 akcemi + platform admin flag.
const PROMOTER_ID = 'c76c589f-b78d-4433-824f-71e3611e995f';

function walk(dir, acc = []) {
  let entries; try { entries = readdirSync(dir); } catch { return acc; }
  for (const n of entries) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, acc);
    else if (n.endsWith('.ts') || n.endsWith('.tsx')) acc.push(f);
  }
  return acc;
}

function extractTables(roots) {
  const tables = new Set();
  for (const root of roots) {
    for (const f of walk(root)) {
      const src = readFileSync(f, 'utf8');
      const re = /(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+\.[a-z_]+)/gi;
      let m;
      while ((m = re.exec(src))) {
        const t = m[1].toLowerCase();
        if (!t.startsWith('information_schema') && !t.startsWith('pg_')) tables.add(t);
      }
    }
  }
  return [...tables].sort();
}

const p = (s) => new URL(s, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

async function counts(client, table) {
  try { return Number((await client.query(`SELECT count(*) n FROM ${table}`)).rows[0].n); }
  catch (e) { return e.code === '42P01' ? null : -1; } // 42P01 = neexistuje/view
}

async function main() {
  const tables = extractTables([
    p('../src/app/api/admin'),
    p('../src/app/api/platform'),
    p('../src/app/api/organizer'),
  ]);

  const pool = new pg.Pool({ connectionString: cs, max: 4 });
  const c = await pool.connect();
  const who = (await c.query('SELECT current_user, (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) b')).rows[0];
  console.log(`\n═══ AUDIT admin/platform read cest pod RLS ═══`);
  console.log(`DB role: ${who.current_user} | BYPASSRLS: ${who.b} | tabulek: ${tables.length}`);
  if (who.b) { console.log('\n⚠️  Role má BYPASSRLS → audit slepý. Spusť proti tixly_rls_test.\n'); await pool.end(); return; }

  // RLS-enabled mapa
  const rlsRows = (await c.query(`
    SELECT n.nspname||'.'||rel.relname AS t, rel.relrowsecurity
    FROM pg_class rel JOIN pg_namespace n ON n.oid=rel.relnamespace WHERE rel.relkind='r'`)).rows;
  const rlsOn = new Map(rlsRows.map((r) => [r.t, r.relrowsecurity]));

  const lockouts = [], noRls = [], ok = [], empty = [], missing = [];

  for (const t of tables) {
    await c.query('BEGIN');
    await c.query(`SET LOCAL app.role='system'`);
    const svc = await counts(c, t);
    await c.query('COMMIT');
    if (svc === null) { missing.push(t); continue; }
    if (svc === 0) { empty.push(t); continue; }

    await c.query('BEGIN');
    await c.query(`SET LOCAL app.is_platform_admin='true'`);
    await c.query(`SET LOCAL app.role='admin'`);
    const adm = await counts(c, t);
    await c.query('COMMIT');

    await c.query('BEGIN');
    await c.query(`SET LOCAL app.current_promoter_id='${PROMOTER_ID}'`);
    await c.query(`SET LOCAL app.role='promoter'`);
    const pro = await counts(c, t);
    await c.query('COMMIT');

    const rls = rlsOn.get(t);
    if (rls === false) { noRls.push(`${t} (svc=${svc})`); continue; }
    if (adm === 0 && pro === 0) lockouts.push(`${t}  svc=${svc} admin=${adm} promoter=${pro}`);
    else ok.push(`${t} (admin=${adm} pro=${pro}/${svc})`);
  }

  console.log(`\n🔴 LOCKOUT (${lockouts.length}) — RLS=on, service vidí, admin i promotér 0:`);
  if (!lockouts.length) console.log('   (žádné) ✅');
  lockouts.forEach((g) => console.log('   •', g));

  console.log(`\n🟡 RLS VYPNUTÉ (${noRls.length}) — bez izolace (ne lockout, ale chybí RLS):`);
  noRls.forEach((g) => console.log('   •', g));

  console.log(`\n🟢 OK — admin/promotér vidí (${ok.length})`);
  console.log(`⚪ prázdné, nelze posoudit (${empty.length})`);
  console.log(`⏭️  view/neexistuje (${missing.length})`);
  console.log('\nPozn.: promoter=0 může být OK (promotér ${PROMOTER_ID} ta data nevlastní);');
  console.log('kritické je admin=0 u /platform tabulek (master admin MUSÍ vidět).');

  await c.release(); await pool.end();
  if (lockouts.length) process.exitCode = 1;
}
main().catch((e) => { console.error('💥', e.message); process.exit(1); });
