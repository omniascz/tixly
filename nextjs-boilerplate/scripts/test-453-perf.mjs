#!/usr/bin/env node
/**
 * test-453-perf.mjs — 453 na NAPLNĚNÉM klonu: cesty + výkon + šestá větev.
 *
 * Předchozí měření běžela na prázdné databázi, takže o výkonu neřekla nic
 * a plán dotazu byl bezcenný (seq scan nad 0 řádky vypadá skvěle).
 * Tenhle skript nasype řádově reálná data a měří tři stavy:
 *
 *   BASE  — dnešní `USING (true)`
 *   453   — pět větví
 *   453+6 — šest větví (přidána cesta přes `tickets`, §40)
 *
 * V každém stavu: 10 sond na cesty + `EXPLAIN (ANALYZE)` typického JOINu
 * ze skupiny „přes orders" (63 sites).
 *
 *   NEON_API_KEY=... node scripts/test-453-perf.mjs clone.json
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const M453 = new URL('../../migrations/453_users_select_scoped.sql', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const N_USERS = 10_000;
const N_PROMOTERS = 50;
const N_EVENTS_PER = 2;
const N_ORDERS = 50_000;
const N_TICKETS = 100_000;

const owner = new pg.Client({ connectionString: clone.ownerUri, statement_timeout: 0 });
await owner.connect();
await owner.query(`SET statement_timeout = 0`);

const t0 = Date.now();
console.log('── hromadný seed ──');

// ── promotéři + místa + akce + typy lístků ──────────────────────────────────
await owner.query(`
  INSERT INTO platform.promoters (id,name,email)
  SELECT gen_random_uuid(), 'P'||g, 'p'||g||'@seed.cz' FROM generate_series(1,${N_PROMOTERS}) g`);
await owner.query(`
  INSERT INTO catalog.venues (id,name,city,country,capacity)
  SELECT gen_random_uuid(), 'V'||g, 'Praha', 'CZ', 500 FROM generate_series(1,${N_PROMOTERS}) g`);
await owner.query(`
  INSERT INTO identity.users (id,email,name,gdpr_consent_at)
  SELECT gen_random_uuid(), 'u'||g||'@seed.cz', 'U'||g, now() FROM generate_series(1,${N_USERS}) g`);
// akce: každý promotér N_EVENTS_PER, venue a organizer namapované po pořadí
await owner.query(`
  WITH p AS (SELECT id, row_number() OVER (ORDER BY id) rn FROM platform.promoters),
       v AS (SELECT id, row_number() OVER (ORDER BY id) rn FROM catalog.venues),
       u AS (SELECT id, row_number() OVER (ORDER BY id) rn FROM identity.users)
  INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,title,date_start,slug)
  SELECT gen_random_uuid(), p.id, u.id, v.id, 'E'||p.rn||'-'||s,
         now() + (s||' day')::interval, 'ev-'||p.rn||'-'||s
  FROM p JOIN v ON v.rn=p.rn JOIN u ON u.rn=p.rn, generate_series(1,${N_EVENTS_PER}) s`);
await owner.query(`
  INSERT INTO catalog.ticket_types (id,event_id,name,kind,base_price,total_qty,remaining_qty)
  SELECT gen_random_uuid(), e.id, 'TT', 'standing', 500, 1000, 1000 FROM catalog.events e`);

// ── objednávky: náhodný uživatel × náhodná akce ─────────────────────────────
await owner.query(`
  WITH u AS (SELECT id, row_number() OVER (ORDER BY id) rn FROM identity.users),
       e AS (SELECT id, row_number() OVER (ORDER BY id) rn FROM catalog.events),
       nu AS (SELECT count(*) c FROM identity.users),
       ne AS (SELECT count(*) c FROM catalog.events)
  INSERT INTO orders.orders (id,user_id,event_id,total_amount,expires_at)
  SELECT gen_random_uuid(), u.id, e.id, 500, now()+interval '1 day'
  FROM generate_series(1,${N_ORDERS}) g
  JOIN nu ON true JOIN ne ON true
  JOIN u  ON u.rn = 1 + (g % nu.c)
  JOIN e  ON e.rn = 1 + (g % ne.c)`);

// ── lístky: vlastník je ZÁMĚRNĚ jiný uživatel než objednavatel (dárky) ──────
await owner.query(`
  WITH o AS (SELECT o.id, o.event_id, o.user_id, row_number() OVER (ORDER BY o.id) rn FROM orders.orders o),
       u AS (SELECT id, row_number() OVER (ORDER BY id) rn FROM identity.users),
       nu AS (SELECT count(*) c FROM identity.users),
       no AS (SELECT count(*) c FROM orders.orders)
  INSERT INTO tickets.tickets (id,order_id,ticket_type_id,owner_id,original_owner_id,
                               totp_secret_encrypted,totp_secret_iv,original_price)
  SELECT gen_random_uuid(), o.id, tt.id,
         CASE WHEN g % 5 = 0 THEN u.id ELSE o.user_id END,   -- každý 5. je dárek
         o.user_id, '\\x00', '\\x00', 500
  FROM generate_series(1,${N_TICKETS}) g
  JOIN no ON true JOIN nu ON true
  JOIN o  ON o.rn = 1 + (g % no.c)
  JOIN u  ON u.rn = 1 + ((g*7) % nu.c)
  JOIN LATERAL (SELECT id FROM catalog.ticket_types WHERE event_id=o.event_id LIMIT 1) tt ON true`);

await owner.query(`ANALYZE identity.users; ANALYZE orders.orders; ANALYZE catalog.events; ANALYZE tickets.tickets; ANALYZE platform.promoter_members`);
const counts = await owner.query(`
  SELECT (SELECT count(*) FROM identity.users) users,
         (SELECT count(*) FROM orders.orders) orders,
         (SELECT count(*) FROM tickets.tickets) tickets,
         (SELECT count(*) FROM catalog.events) events`);
console.log(`   ${JSON.stringify(counts.rows[0])}  za ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ── vybrat testovacího promotéra a vztažené uživatele ───────────────────────
const P = (await owner.query(`
  SELECT e.promoter_id pid, e.id eid FROM catalog.events e
  JOIN orders.orders o ON o.event_id=e.id GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 1`)).rows[0];
const pick = async (sql, p = []) => (await owner.query(sql, p)).rows[0]?.id ?? null;
const U = {
  ORDER: await pick(`SELECT o.user_id id FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id WHERE e.promoter_id=$1 LIMIT 1`, [P.pid]),
  GIFT: await pick(`SELECT t.owner_id id FROM tickets.tickets t JOIN orders.orders o ON o.id=t.order_id
                    JOIN catalog.events e ON e.id=o.event_id WHERE e.promoter_id=$1 AND t.owner_id<>o.user_id
                    AND NOT EXISTS (SELECT 1 FROM orders.orders o2 JOIN catalog.events e2 ON e2.id=o2.event_id
                                    WHERE o2.user_id=t.owner_id AND e2.promoter_id=$1) LIMIT 1`, [P.pid]),
  OTHER: await pick(`SELECT o.user_id id FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id WHERE e.promoter_id<>$1
                     AND NOT EXISTS (SELECT 1 FROM orders.orders o2 JOIN catalog.events e2 ON e2.id=o2.event_id
                                     WHERE o2.user_id=o.user_id AND e2.promoter_id=$1) LIMIT 1`, [P.pid]),
};
// vztahy, které jinak v datech nejsou
const mk = async (email) => {
  const id = randomUUID();
  await owner.query(`INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'X',now())`, [id, email]);
  return id;
};
U.TEAM = await mk(`team_${randomUUID().slice(0, 6)}@seed.cz`);
await owner.query(`INSERT INTO platform.promoter_members (promoter_id,user_id,role) VALUES ($1,$2,'admin')`, [P.pid, U.TEAM]);
U.NOORDER = await mk(`noorder_${randomUUID().slice(0, 6)}@seed.cz`);
U.FRIEND = await mk(`friend_${randomUUID().slice(0, 6)}@seed.cz`);
U.WAITLIST = await mk(`wait_${randomUUID().slice(0, 6)}@seed.cz`);
U.RESALE = await mk(`resale_${randomUUID().slice(0, 6)}@seed.cz`);
// waitlist / verified_fan / resale vazby (best effort — schéma se liší)
const tryIns = async (label, sql, p) => {
  try { await owner.query(sql, p); return true; } catch (e) { console.log(`   [seed] ${label}: ${e.code}`); return false; }
};
const okWait = await tryIns('waiting_room.queue_entries',
  `INSERT INTO waiting_room.queue_entries (event_id,user_id) VALUES ($1,$2)`, [P.eid, U.WAITLIST]);
const okVF = await tryIns('verified_fan.registrations',
  `INSERT INTO verified_fan.registrations (event_id,user_id) VALUES ($1,$2)`, [P.eid, U.WAITLIST]);
const okResale = await tryIns('resale listing',
  `INSERT INTO resale.resale_listings (ticket_id,seller_id,price)
   SELECT t.id,$2,100 FROM tickets.tickets t JOIN orders.orders o ON o.id=t.order_id
   JOIN catalog.events e ON e.id=o.event_id WHERE e.promoter_id=$1 LIMIT 1`, [P.pid, U.RESALE]);

const PROBES = [
  ['orders (63 sites)', 'ORDER', `SELECT count(*)::int n FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
     JOIN identity.users u ON u.id=o.user_id WHERE e.promoter_id=$1 AND u.id=$2`],
  ['tickets (14 sites)', 'GIFT', `SELECT count(*)::int n FROM tickets.tickets t JOIN orders.orders o ON o.id=t.order_id
     JOIN catalog.events e ON e.id=o.event_id JOIN identity.users u ON u.id=t.owner_id
     WHERE e.promoter_id=$1 AND u.id=$2`],
  ['tým (11 sites)', 'TEAM', `SELECT count(*)::int n FROM platform.promoter_members pm JOIN identity.users u ON u.id=pm.user_id
     WHERE pm.promoter_id=$1 AND u.id=$2`],
  ['přímo podle id', 'NOORDER', `SELECT count(*)::int n FROM identity.users u WHERE $1::uuid IS NOT NULL AND u.id=$2`],
  ['friend_id', 'FRIEND', `SELECT count(*)::int n FROM identity.users u WHERE $1::uuid IS NOT NULL AND u.id=$2`],
  ['waitlist/verified_fan', 'WAITLIST', `SELECT count(*)::int n FROM identity.users u WHERE $1::uuid IS NOT NULL AND u.id=$2`],
  ['resale protistrana', 'RESALE', `SELECT count(*)::int n FROM identity.users u WHERE $1::uuid IS NOT NULL AND u.id=$2`],
  ['🔒 cizí tenant', 'OTHER', `SELECT count(*)::int n FROM identity.users u WHERE $1::uuid IS NOT NULL AND u.id=$2`],
];

const HOT = `SELECT u.id,u.email,u.name FROM orders.orders o
  JOIN catalog.events e ON e.id=o.event_id
  JOIN identity.users u ON u.id=o.user_id
  WHERE e.promoter_id=$1 LIMIT 100`;

async function measure(label) {
  const app = new pg.Client({ connectionString: clone.appUri });
  await app.connect();
  await app.query(`SET app.current_promoter_id = '${P.pid}'`);
  await app.query(`SET app.role = 'promoter'`);
  const out = {};
  for (const [name, key, sql] of PROBES) {
    if (!U[key]) { out[name] = 'n/a'; continue; }
    try { out[name] = (await app.query(sql, [P.pid, U[key]])).rows[0].n; }
    catch (e) { out[name] = `ERR ${e.code}`; }
  }
  const plan = (await app.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${HOT}`, [P.pid])).rows[0]['QUERY PLAN'][0];
  out.__ms = plan['Execution Time'];
  out.__plan = JSON.stringify(plan.Plan).match(/"Node Type":"[^"]+"/g).slice(0, 6).map((x) => x.split(':"')[1].replace('"', ''));
  await app.end();
  console.log(`\n── ${label} ── EXPLAIN: ${out.__ms.toFixed(1)} ms | uzly: ${out.__plan.join(' → ')}`);
  for (const [n] of PROBES) console.log(`   ${String(out[n]).padStart(5)}  ${n}`);
  return out;
}

const BASE = await measure('BASE (dnešní USING(true))');
await owner.query(readFileSync(M453, 'utf8'));
const R453 = await measure('453 (pět větví)');

const SIXTH = `
DROP POLICY IF EXISTS p_users_select ON identity.users;
CREATE POLICY p_users_select ON identity.users FOR SELECT USING (
  public.app_is_service() OR public.app_is_platform_admin()
  OR id = public.app_current_user_id()
  OR (public.app_current_promoter_id() IS NOT NULL AND EXISTS (
        SELECT 1 FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
        WHERE o.user_id=users.id AND e.promoter_id=public.app_current_promoter_id()))
  OR (public.app_current_promoter_id() IS NOT NULL AND EXISTS (
        SELECT 1 FROM platform.promoter_members pm
        WHERE pm.user_id=users.id AND pm.promoter_id=public.app_current_promoter_id()))
  OR (public.app_current_promoter_id() IS NOT NULL AND EXISTS (
        SELECT 1 FROM tickets.tickets tk
        JOIN orders.orders o2 ON o2.id=tk.order_id
        JOIN catalog.events e2 ON e2.id=o2.event_id
        WHERE tk.owner_id=users.id AND e2.promoter_id=public.app_current_promoter_id())));`;
await owner.query(SIXTH);
const R6 = await measure('453 + šestá větev (tickets)');
await owner.end();

console.log('\n═══ SROVNÁNÍ CEST ═══');
console.log('cesta                       BASE   453   453+6');
for (const [n] of PROBES)
  console.log(`${n.padEnd(28)}${String(BASE[n]).padStart(5)}${String(R453[n]).padStart(6)}${String(R6[n]).padStart(7)}`);
console.log('\n═══ VÝKON (EXPLAIN ANALYZE, 100 řádků) ═══');
console.log(`  BASE  : ${BASE.__ms.toFixed(1)} ms`);
console.log(`  453   : ${R453.__ms.toFixed(1)} ms  (${(R453.__ms / BASE.__ms).toFixed(1)}×)`);
console.log(`  453+6 : ${R6.__ms.toFixed(1)} ms  (${(R6.__ms / BASE.__ms).toFixed(1)}× proti BASE, ${(R6.__ms / R453.__ms).toFixed(1)}× proti 453)`);
