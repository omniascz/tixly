#!/usr/bin/env node
/**
 * test-453-join-paths.mjs — přežije migraci 453 všech 126 JOIN sites na users?
 *
 * 453 je otestovaná proti JEDNOMU tvaru JOINu (přes `orders`). Grep ukázal,
 * že tvarů je víc — a některé sahají na uživatele, kteří u promotéra ŽÁDNOU
 * objednávku nemají. Ti po 453 můžou tiše zmizet.
 *
 * Skript seedne po jednom uživateli pro každý VZTAH a změří viditelnost
 * pod `tixly_app` v kontextu promotéra A, před migrací a po ní.
 *
 *   NEON_API_KEY=... node scripts/test-453-join-paths.mjs clone.json
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
  ORDER: randomUUID(), // zákazník s objednávkou u A
  GIFT: randomUUID(), // vlastník lístku, objednávku má někdo jiný (dárek/transfer)
  TEAM: randomUUID(), // člen týmu A, bez objednávky
  NOORDER: randomUUID(), // guest založený, objednávku nedokončil
  ANON: randomUUID(), // měl objednávku u A, ale anonymizovaný
  ACTOR: randomUUID(), // platformní pracovník v audit logu, bez vztahu k A
  OTHER: randomUUID(), // zákazník promotéra B
};

async function mkPromoter(p) {
  await owner.query(`INSERT INTO platform.promoters (id,name,email) VALUES ($1,$2,$3)`, [p.promoter, 'P' + p.promoter.slice(0, 5), `p${p.promoter.slice(0, 6)}@x.cz`]);
  await owner.query(`INSERT INTO catalog.venues (id,name,city,country,capacity) VALUES ($1,'V','Praha','CZ',100)`, [p.venue]);
  await owner.query(
    `INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,title,date_start,slug)
     VALUES ($1,$2,$3,$4,'E',now(),$5)`,
    [p.event, p.promoter, U.ORDER, p.venue, 'ev-' + p.event.slice(0, 8)],
  );
}
const mkUser = (id, extra = '') =>
  owner.query(
    `INSERT INTO identity.users (id,email,name,gdpr_consent_at${extra ? ',anonymized_at' : ''})
     VALUES ($1,$2,'U',now()${extra ? ',now()' : ''})`,
    [id, `u_${id.slice(0, 8)}@x.cz`],
  );
const mkOrder = (user, event) => {
  const id = randomUUID();
  return owner
    .query(
      `INSERT INTO orders.orders (id,user_id,event_id,total_amount,expires_at)
       VALUES ($1,$2,$3,100,now()+interval '1 day')`,
      [id, user, event],
    )
    .then(() => id);
};

for (const u of Object.values(U)) await mkUser(u, u === U.ANON ? 'anon' : '');
await mkPromoter(A);
await mkPromoter(B);
await owner
  .query(
    `INSERT INTO catalog.ticket_types (id,event_id,name,kind,base_price,total_qty,remaining_qty)
     VALUES ($1,$2,'TT','standing',100,10,10)`,
    [A.tt, A.event],
  )
  .catch((e) => console.log('  ticket_types:', e.code, e.message.slice(0, 90)));

const oOrder = await mkOrder(U.ORDER, A.event);
await mkOrder(U.ANON, A.event);
await mkOrder(U.OTHER, B.event);
await owner.query(`INSERT INTO platform.promoter_members (promoter_id,user_id,role) VALUES ($1,$2,'admin')`, [A.promoter, U.TEAM]);
// lístek: vlastní U.GIFT, ale objednávka patří U.ORDER (dárek / po transferu)
await owner
  .query(
    `INSERT INTO tickets.tickets (id,order_id,ticket_type_id,owner_id,original_owner_id,
       totp_secret_encrypted,totp_secret_iv,original_price)
     VALUES ($1,$2,$3,$4,$5,'\\x00','\\x00',100)`,
    [randomUUID(), oOrder, A.tt, U.GIFT, U.ORDER],
  )
  .catch((e) => console.log('  tickets:', e.code, e.message.slice(0, 90)));

/** Sondy = reálné tvary JOINů z kódu, scoped na promotéra A. */
const PROBES = [
  ['orders  (53+10 sites) u.id=o.user_id', U.ORDER,
    `SELECT count(*)::int n FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
     JOIN identity.users u ON u.id=o.user_id WHERE e.promoter_id=$1 AND u.id=$2`],
  ['tickets (14 sites)    u.id=t.owner_id', U.GIFT,
    `SELECT count(*)::int n FROM tickets.tickets t JOIN orders.orders o ON o.id=t.order_id
     JOIN catalog.events e ON e.id=o.event_id JOIN identity.users u ON u.id=t.owner_id
     WHERE e.promoter_id=$1 AND u.id=$2`],
  ['team    (11 sites)    u.id=pm.user_id', U.TEAM,
    `SELECT count(*)::int n FROM platform.promoter_members pm JOIN identity.users u ON u.id=pm.user_id
     WHERE pm.promoter_id=$1 AND u.id=$2`],
  ['přímo podle id        users WHERE id=', U.NOORDER,
    `SELECT count(*)::int n FROM identity.users u WHERE $1::uuid IS NOT NULL AND u.id=$2`],
  ['podle e-mailu (8 s.)  LOWER(u.email)=', U.NOORDER,
    `SELECT count(*)::int n FROM identity.users u WHERE $1::uuid IS NOT NULL
     AND LOWER(u.email)=LOWER((SELECT email FROM identity.users WHERE id=$2))`],
  ['anonymizovaný (měl obj. u A)', U.ANON,
    `SELECT count(*)::int n FROM identity.users u WHERE $1::uuid IS NOT NULL AND u.id=$2`],
  ['actor/audit (9 sites) bez vztahu k A', U.ACTOR,
    `SELECT count(*)::int n FROM identity.users u WHERE $1::uuid IS NOT NULL AND u.id=$2`],
  ['🔒 cizí tenant (musí ZMIZET)', U.OTHER,
    `SELECT count(*)::int n FROM identity.users u WHERE $1::uuid IS NOT NULL AND u.id=$2`],
];

async function run(label) {
  const app = new pg.Client({ connectionString: clone.appUri });
  await app.connect();
  await app.query(`SET app.current_promoter_id = '${A.promoter}'`);
  await app.query(`SET app.role = 'promoter'`);
  const out = {};
  for (const [name, uid, sql] of PROBES) {
    try {
      out[name] = (await app.query(sql, [A.promoter, uid])).rows[0].n;
    } catch (e) {
      out[name] = `ERR ${e.code}`;
    }
  }
  await app.end();
  console.log(`\n── ${label} ──`);
  for (const [name] of PROBES) console.log(`  ${String(out[name]).padStart(5)}  ${name}`);
  return out;
}

const before = await run('PŘED 453 (dnešní USING(true) — vidí vše)');
await owner.query(readFileSync(M453, 'utf8'));
console.log('\n[mig] 453 aplikována');
const after = await run('PO 453');
await owner.end();

console.log('\n═══ VERDIKT PO TVARECH ═══');
let lost = 0;
for (const [name] of PROBES) {
  const b = before[name], a = after[name];
  const isolace = name.startsWith('🔒');
  let verdikt;
  if (isolace) verdikt = a === 0 ? '✅ správně zmizel' : '🔴 STÁLE VIDITELNÝ';
  else if (b > 0 && a === 0) { verdikt = '🔴 ZTRACENO'; lost++; }
  else if (b > 0 && a > 0) verdikt = '✅ drží';
  else verdikt = '⚪ neseedováno';
  console.log(`  ${b} → ${a}  ${verdikt.padEnd(20)} ${name}`);
}
console.log(`\nTVARŮ, KTERÉ PO 453 PŘESTANOU VIDĚT DATA: ${lost}`);
