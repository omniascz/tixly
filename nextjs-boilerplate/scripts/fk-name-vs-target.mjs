#!/usr/bin/env node
/**
 * fk-name-vs-target.mjs — kam sloupec SKUTECNE miri, ne kam podle jmena vypada.
 *
 * Duvod (FINDINGS 109): b2b_transactions.user_id neukazuje na identity.users,
 * ale na platform.b2b_account_users. Klasifikace v §100 stala na JMENU sloupce.
 * Katalogovy sken se dival na jmena, ne na cizi klice — proto tu tridu chyby
 * najit neumel.
 *
 * Skript cte pg_constraint (contype='f') a pro kazdy sloupec s tenant-jmenem
 * porovna ocekavany cil s realnym confrelid.
 *
 * Sloupce BEZ FK se vypisuji zvlast: tam se cil overit NEDA a je to vlastni
 * trida rizika, ne nesoulad.
 *
 *   node scripts/fk-name-vs-target.mjs --url=<conn> [--only461]
 */
import pg from 'pg';

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const h = argv.find((a) => a.startsWith(`--${n}=`));
  return h ? h.slice(n.length + 3) : d;
};
const flag = (n) => argv.includes(`--${n}`);

const EXPECT = {
  user_id: 'identity.users',
  promoter_id: 'platform.promoters',
  event_id: 'catalog.events',
  order_id: 'orders.orders',
};

const T461 = new Set([
  'analytics.yield_rules', 'brands.event_partnerships', 'catalog.event_reschedules',
  'catalog.productions', 'catalog.season_pass_products', 'communications.broadcasts',
  'communications.emergency_announcements', 'orders.guestlist_entries',
  'orders.lottery_campaigns', 'orders.phone_orders', 'orders.press_accreditations',
  'orders.school_bookings', 'platform.import_jobs', 'platform.promoter_contacts',
  'platform.promoter_onboarding', 'pricing.dynamic_pricing_rules',
  'identity.fan_profiles', 'notifications.push_sent_log', 'platform.agent_mandates',
]);
const MERENO = new Set([
  'catalog.productions', 'platform.promoter_contacts', 'orders.guestlist_entries',
  'communications.broadcasts', 'orders.school_bookings', 'identity.fan_profiles',
]);

const uri = opt('url') || process.env.DATABASE_URL;
if (!uri) { console.error('chybi --url='); process.exit(2); }
const c = new pg.Client({ connectionString: uri });
await c.connect();

const cols = (await c.query(`
  SELECT n.nspname||'.'||cl.relname AS tbl, a.attname AS col, a.attnotnull AS nn
  FROM pg_class cl
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE cl.relkind = 'r'
    AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
    AND a.attname = ANY($1)
  ORDER BY 1, 2`, [Object.keys(EXPECT)])).rows;

const fks = (await c.query(`
  SELECT n.nspname||'.'||cl.relname AS tbl, a.attname AS col,
         fn.nspname||'.'||fc.relname AS target
  FROM pg_constraint co
  JOIN pg_class cl ON cl.oid = co.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_class fc ON fc.oid = co.confrelid
  JOIN pg_namespace fn ON fn.oid = fc.relnamespace
  JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = co.conkey[1]
  WHERE co.contype = 'f' AND array_length(co.conkey,1) = 1`)).rows;

const fkMap = new Map(fks.map((f) => [`${f.tbl}|${f.col}`, f.target]));

const policies = (await c.query(`
  SELECT schemaname||'.'||tablename AS tbl, policyname AS pol,
         coalesce(qual,'')||' '||coalesce(with_check,'') AS expr
  FROM pg_policies`)).rows;

const mismatch = [], nofk = [], ok = [];
for (const r of cols) {
  if (flag('only461') && !T461.has(r.tbl)) continue;
  const target = fkMap.get(`${r.tbl}|${r.col}`);
  const want = EXPECT[r.col];
  if (!target) { nofk.push({ ...r, want }); continue; }
  if (target !== want) mismatch.push({ ...r, want, target });
  else ok.push(r);
}

// Ktere nesoulady se objevuji v nejake policy — tam je to tichá díra nebo mrtvá policy
const inPolicy = (tbl, col) => policies
  .filter((p) => p.tbl === tbl && new RegExp(`\\b${col}\\b`).test(p.expr))
  .map((p) => p.pol);

console.log(`sloupcu s tenant-jmenem: ${cols.length}`);
console.log(`  FK sedi s ocekavanim : ${ok.length}`);
console.log(`  FK MIRI JINAM        : ${mismatch.length}`);
console.log(`  BEZ FK (nelze overit): ${nofk.length}`);

let inPol = 0;
console.log('\n=== NESOULAD JMENO vs CIL FK ===');
for (const m of mismatch) {
  const pols = inPolicy(m.tbl, m.col);
  if (pols.length) inPol++;
  const tag = T461.has(m.tbl) ? (MERENO.has(m.tbl) ? ' [461/MERENO]' : ' [461/nemereno]') : '';
  console.log(` ${m.tbl}.${m.col} -> ${m.target}  (cekano ${m.want})${tag}` +
    (pols.length ? `  V POLICY: ${pols.join(',')}` : '  (v zadne policy)'));
}
console.log(`\nz toho v policies: ${inPol}`);

console.log('\n=== BEZ FK (vlastni trida rizika) ===');
const nofkPol = nofk.filter((r) => inPolicy(r.tbl, r.col).length);
console.log(` celkem ${nofk.length}, z toho v policies ${nofkPol.length}`);
for (const r of nofkPol.slice(0, 25)) {
  const tag = T461.has(r.tbl) ? ' [461]' : '';
  console.log(`  ${r.tbl}.${r.col}${tag}  V POLICY: ${inPolicy(r.tbl, r.col).join(',')}`);
}
if (nofkPol.length > 25) console.log(`  … a dalsich ${nofkPol.length - 25}`);

console.log('\n=== 19 TABULEK Z 461 ===');
for (const t of [...T461].sort()) {
  const col = cols.find((x) => x.tbl === t && (x.col === 'promoter_id' || x.col === 'user_id'));
  if (!col) { console.log(` ${t.padEnd(40)} SLOUPEC NENALEZEN`); continue; }
  const target = fkMap.get(`${t}|${col.col}`);
  const want = EXPECT[col.col];
  const verd = !target ? 'BEZ FK — neoveritelne' : target === want ? 'FK OK' : `FK MIRI JINAM -> ${target}`;
  console.log(` ${t.padEnd(40)} ${col.col.padEnd(12)} ${verd}${MERENO.has(t) ? '  (izolace zmerena)' : ''}`);
}
await c.end();
