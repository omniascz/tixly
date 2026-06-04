/**
 * AUDIT — veřejné read cesty pod ENFORCED RLS.
 *
 * Proč: na produkci běží app s BYPASSRLS (RLS spí), takže chybějící public-read
 * policy se NEPROJEVÍ. Lokálně (tixly_rls_test, NOBYPASSRLS) ale veřejná stránka
 * bez app kontextu vidí jen to, co pustí public policy → skrytá data ("Online"
 * u venues, prázdné sekce). Tenhle skript to najde DŘÍV, než na to někdo narazí.
 *
 * Co dělá: vytáhne tabulky, které čtou veřejné server-komponenty + public API,
 * a empiricky porovná, kolik řádků vidí SERVICE vs ANONYM (žádný kontext).
 * service>0 & anonym=0 = pravděpodobná díra (chybí public-read policy).
 *
 * Spuštění: node scripts/audit-public-rls.mjs
 * (vyžaduje DATABASE_URL na NOBYPASSRLS roli — jinak hlásí "RLS spí").
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const cs = (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1];

// Tabulky, co jsou user/order-scoped (NE public-display) — čtou se v auth/token
// kontextu, ne anonymně. Vyloučíme z gap-reportu (jejich "anonym=0" je správně).
const USER_SCOPED = new Set([
  'orders.orders', 'orders.order_items', 'tickets.tickets', 'tickets.ticket_redemptions',
  'identity.users', 'subscriptions.holders', 'public.order_addons', 'social_graph.friendships',
  'marketing.tracking_pixels', 'catalog.waitlist_entries',
]);
// Záměrně tajné (validují se v service kontextu, ne public policy).
const SECRET = new Set(['catalog.access_codes', 'catalog.access_code_ticket_types']);

function walk(dir, acc = []) {
  let entries; try { entries = readdirSync(dir); } catch { return acc; }
  for (const n of entries) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, acc);
    else if (n.endsWith('.tsx') || n.endsWith('.ts')) acc.push(f);
  }
  return acc;
}

function extractTables() {
  const roots = [
    new URL('../src/app/[locale]', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
    new URL('../src/app/api/events', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
    new URL('../src/app/api/public', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
    new URL('../src/app/api/p', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
    new URL('../src/app/api/resale', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
  ];
  const tables = new Set();
  for (const root of roots) {
    for (const f of walk(root)) {
      const src = readFileSync(f, 'utf8');
      const re = /(?:FROM|JOIN)\s+([a-z_]+\.[a-z_]+)/g;
      let m;
      while ((m = re.exec(src))) {
        const t = m[1];
        if (!t.startsWith('information_schema') && !t.startsWith('pg_')) tables.add(t);
      }
    }
  }
  return [...tables].sort();
}

async function main() {
  const svc = new pg.Pool({ connectionString: cs });
  const pub = new pg.Pool({ connectionString: cs });
  const cSvc = await svc.connect(); await cSvc.query(`SET app.role='service'`);
  const cPub = await pub.connect();

  const who = (await cPub.query('SELECT current_user, (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) b')).rows[0];
  console.log(`\n═══ AUDIT veřejných read cest pod RLS ═══`);
  console.log(`DB role: ${who.current_user} | BYPASSRLS: ${who.b}`);
  if (who.b) {
    console.log('\n⚠️  Role má BYPASSRLS → RLS se neaplikuje, audit nic neodhalí.');
    console.log('    Spusť proti NOBYPASSRLS roli (tixly_rls_test), jinak je test slepý.\n');
    await svc.end(); await pub.end(); return;
  }

  const tables = extractTables();
  const gaps = [], ok = [], empty = [], skipped = [];
  for (const t of tables) {
    if (USER_SCOPED.has(t)) { skipped.push(`${t} (user-scoped)`); continue; }
    let s, p;
    try { s = Number((await cSvc.query(`SELECT count(*) n FROM ${t}`)).rows[0].n); }
    catch { continue; } // view/neexistuje
    try { p = Number((await cPub.query(`SELECT count(*) n FROM ${t}`)).rows[0].n); }
    catch { p = -1; }
    if (SECRET.has(t)) { (p === 0 ? ok : gaps).push(`${t} (tajné, anonym=${p} ${p === 0 ? '✓ skryté' : '⚠ ODKRYTÉ!'})`); continue; }
    if (s === 0) empty.push(t);
    else if (p === 0) gaps.push(`${t}  (service=${s} / anonym=0)`);
    else ok.push(`${t} (${p}/${s})`);
  }

  // U gapů ověř, jestli data SKUTEČNĚ mají být public (patří k published akci),
  // nebo je anonym=0 správně (data jen u cancelled/draft akcí).
  console.log(`\n🔴 PODEZŘELÉ DÍRY (${gaps.length}) — service vidí, anonym ne:`);
  if (!gaps.length) console.log('   (žádné) ✅');
  gaps.forEach((g) => console.log('   •', g));
  console.log(`\n🟢 OK — anonym vidí veřejná data (${ok.length})`);
  console.log(`⚪ prázdné, nelze posoudit z dat (${empty.length}): ${empty.join(', ')}`);
  console.log(`⏭️  přeskočeno — user-scoped (${skipped.length})`);
  console.log('\nPozn.: "díra" může být i false-positive, když data patří jen k cancelled/draft');
  console.log('akcím (pak je anonym=0 správně). Ověř: JOIN events e ON ... WHERE e.status=\'published\'.');

  await svc.end(); await pub.end();
  if (gaps.length) process.exitCode = 1;
}
main().catch((e) => { console.error('💥', e.message); process.exit(1); });
