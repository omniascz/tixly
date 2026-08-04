#!/usr/bin/env node
/**
 * test-453-split.mjs — 453 rozdělená na promotérský a sociální vztah.
 *
 * Měří DVĚ kontextové dimenze zvlášť. Buyer kontext se do §41 dostal až na
 * konec a hned našel rozbité sociální funkce — proto tu má vlastní sadu sond,
 * ne přívěsek.
 *
 * Izolace se ověřuje v OBOU: cizí tenant (promotér) i cizí ne-přítel (buyer).
 *
 *   NEON_API_KEY=... node scripts/test-453-split.mjs clone.json
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const M453 = new URL('../../migrations/453_users_select_scoped.sql', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const owner = new pg.Client({ connectionString: clone.ownerUri });
await owner.connect();

const A = { promoter: randomUUID(), event: randomUUID(), venue: randomUUID(), tt: randomUUID() };
const B = { promoter: randomUUID(), event: randomUUID(), venue: randomUUID() };
const U = {
  ORDER: randomUUID(), GIFT: randomUUID(), TEAM: randomUUID(), VFAN: randomUUID(),
  NOORDER: randomUUID(), ME: randomUUID(), FRIEND: randomUUID(), REQ_IN: randomUUID(),
  REQ_OUT: randomUUID(), STRANGER: randomUUID(), OTHER: randomUUID(),
};

const mkUser = (id) => owner.query(
  `INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'U',now())`,
  [id, `u_${id.slice(0, 8)}@x.cz`]);
async function mkPromoter(p) {
  await owner.query(`INSERT INTO platform.promoters (id,name,email) VALUES ($1,$2,$3)`, [p.promoter, 'P' + p.promoter.slice(0, 5), `p${p.promoter.slice(0, 6)}@x.cz`]);
  await owner.query(`INSERT INTO catalog.venues (id,name,city,country,capacity) VALUES ($1,'V','Praha','CZ',100)`, [p.venue]);
  await owner.query(`INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,title,date_start,slug)
     VALUES ($1,$2,$3,$4,'E',now(),$5)`, [p.event, p.promoter, U.ORDER, p.venue, 'ev-' + p.event.slice(0, 8)]);
}
const mkOrder = async (user, event) => {
  const id = randomUUID();
  await owner.query(`INSERT INTO orders.orders (id,user_id,event_id,total_amount,expires_at)
     VALUES ($1,$2,$3,100,now()+interval '1 day')`, [id, user, event]);
  return id;
};

for (const u of Object.values(U)) await mkUser(u);
await mkPromoter(A); await mkPromoter(B);
await owner.query(`INSERT INTO catalog.ticket_types (id,event_id,name,kind,base_price,total_qty,remaining_qty)
   VALUES ($1,$2,'TT','standing',100,10,10)`, [A.tt, A.event]);
const oOrder = await mkOrder(U.ORDER, A.event);
await mkOrder(U.OTHER, B.event);
await owner.query(`INSERT INTO platform.promoter_members (promoter_id,user_id,role) VALUES ($1,$2,'admin')`, [A.promoter, U.TEAM]);
// lístek vlastní GIFT, objednávku má ORDER (dárek/transfer)
await owner.query(`INSERT INTO tickets.tickets (id,order_id,ticket_type_id,owner_id,original_owner_id,
     totp_secret_encrypted,totp_secret_iv,original_price) VALUES ($1,$2,$3,$4,$5,'\\x00','\\x00',100)`,
  [randomUUID(), oOrder, A.tt, U.GIFT, U.ORDER]);
// verified-fan přihláška BEZ objednávky — přesně smysl té funkce
await owner.query(`INSERT INTO marketing.verified_fan_requests (user_id,event_id) VALUES ($1,$2)`, [U.VFAN, A.event])
  .catch((e) => console.log('  vfr:', e.code, e.message.slice(0, 80)));
// sociální graf kolem U.ME
// CHECK (user_a < user_b) — dvojice se ukládá v kanonickém pořadí, proto
// helper musí kontrolovat OBĚ orientace.
const pair = [U.ME, U.FRIEND].sort();
await owner.query(`INSERT INTO social_graph.friendships (user_a,user_b) VALUES ($1,$2)`, pair)
  .catch((e) => console.log('  friendship:', e.code, e.message.slice(0, 80)));
await owner.query(`INSERT INTO social_graph.friend_requests (from_user_id,to_user_id,status) VALUES ($1,$2,'pending')`, [U.REQ_IN, U.ME])
  .catch((e) => console.log('  req_in:', e.code));
await owner.query(`INSERT INTO social_graph.friend_requests (from_user_id,to_user_id,status) VALUES ($1,$2,'pending')`, [U.ME, U.REQ_OUT])
  .catch((e) => console.log('  req_out:', e.code));

const SEL = `SELECT count(*)::int n FROM identity.users u WHERE u.id=$1`;
const PROMOTER_PROBES = [
  ['orders (63 sites)', 'ORDER'], ['tickets (14 sites)', 'GIFT'], ['tým (11 sites)', 'TEAM'],
  ['verified-fan (bez objednávky)', 'VFAN'], ['⚪ bez vztahu (má zmizet)', 'NOORDER'],
  ['🔒 cizí tenant', 'OTHER'],
];
const BUYER_PROBES = [
  ['vlastní řádek', 'ME'], ['přítel (friendships)', 'FRIEND'],
  ['žádost příchozí (from→me)', 'REQ_IN'], ['žádost odchozí (me→to)', 'REQ_OUT'],
  ['🔒 cizí ne-přítel', 'STRANGER'], ['🔒 cizí tenant', 'OTHER'],
];

async function measure(label) {
  const res = { p: {}, b: {} };
  const pc = new pg.Client({ connectionString: clone.appUri });
  await pc.connect();
  await pc.query(`SET app.current_promoter_id='${A.promoter}'`);
  await pc.query(`SET app.role='promoter'`);
  for (const [n, k] of PROMOTER_PROBES)
    res.p[n] = (await pc.query(SEL, [U[k]])).rows[0].n;
  await pc.end();

  const bc = new pg.Client({ connectionString: clone.appUri });
  await bc.connect();
  await bc.query(`SET app.current_user_id='${U.ME}'`);
  await bc.query(`SET app.role='buyer'`);
  for (const [n, k] of BUYER_PROBES)
    res.b[n] = (await bc.query(SEL, [U[k]])).rows[0].n;
  await bc.end();
  console.log(`\n── ${label} ──`);
  console.log('  PROMOTÉR:');
  for (const [n] of PROMOTER_PROBES) console.log(`    ${String(res.p[n]).padStart(3)}  ${n}`);
  console.log('  BUYER:');
  for (const [n] of BUYER_PROBES) console.log(`    ${String(res.b[n]).padStart(3)}  ${n}`);
  return res;
}

const before = await measure('PŘED (dnešní USING(true))');
await owner.query(readFileSync(M453, 'utf8'));
console.log('\n[mig] 453 (rozdělená) aplikována');
const after = await measure('PO 453 (self + promoter + buyer)');
const pols = await owner.query(`SELECT policyname FROM pg_policies WHERE schemaname='identity' AND tablename='users' AND cmd='SELECT' ORDER BY 1`);
console.log('\nSELECT policies na identity.users:', pols.rows.map((r) => r.policyname).join(', '));
await owner.end();

console.log('\n═══ SROVNÁNÍ ═══');
let broken = 0, leaks = 0;
const line = (n, b, a, isol) => {
  let v;
  if (n.startsWith('⚪')) { v = a === 0 ? '✅ správně zmizel' : '⚠️ stále vidí'; }
  else if (isol) { v = a === 0 ? '✅ izolováno' : '🔴 ÚNIK'; if (a !== 0) leaks++; }
  else if (b > 0 && a === 0) { v = '🔴 ZTRACENO'; broken++; }
  else if (a > 0) v = '✅ drží';
  else v = '⚪';
  console.log(`  ${b} → ${a}  ${v.padEnd(14)} ${n}`);
};
console.log(' PROMOTÉR:');
for (const [n] of PROMOTER_PROBES) line(n, before.p[n], after.p[n], n.startsWith('🔒'));
console.log(' BUYER:');
for (const [n] of BUYER_PROBES) line(n, before.b[n], after.b[n], n.startsWith('🔒'));
console.log(`\nrozbitých cest: ${broken} | úniků: ${leaks}`);
console.log(`\n═══ ${broken === 0 && leaks === 0 ? '✅ VŠE DRŽÍ A IZOLACE PLATÍ' : '❌ NEPOTVRZENO'} ═══`);
process.exit(broken === 0 && leaks === 0 ? 0 : 1);
