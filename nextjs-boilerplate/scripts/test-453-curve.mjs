#!/usr/bin/env node
/**
 * test-453-curve.mjs — od kolika zákazníků přestane být 453 použitelná.
 * §45 měřilo dva body (500 → 130 ms, 30 000 → 18 643 ms). Tohle je křivka.
 * Seed s DISABLE TRIGGER USER — audit trigger jinak vyčerpá strop 512 MB.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const M453 = new URL('../../migrations/453_users_select_scoped.sql', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const SIZES = [500, 2000, 5000, 10000, 20000];
const N_USERS = 30000;

const o = new pg.Client({ connectionString: clone.ownerUri, statement_timeout: 0 });
await o.connect(); await o.query(`SET statement_timeout=0`);
for (const t of ['identity.users','orders.orders','tickets.tickets','catalog.events','catalog.venues','platform.promoters','catalog.ticket_types'])
  await o.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`).catch(()=>{});
await o.query(`INSERT INTO identity.users (id,email,name,gdpr_consent_at)
  SELECT gen_random_uuid(),'u'||g||'@c.cz','U',now() FROM generate_series(1,${N_USERS}) g`);
const U0 = (await o.query(`SELECT id FROM identity.users LIMIT 1`)).rows[0].id;
const proms = [];
for (const n of SIZES) {
  const P = (await o.query(`INSERT INTO platform.promoters (id,name,email) VALUES (gen_random_uuid(),$1,$2) RETURNING id`, ['P'+n, `p${n}@c.cz`])).rows[0].id;
  const V = (await o.query(`INSERT INTO catalog.venues (id,name,city,country,capacity) VALUES (gen_random_uuid(),'V','P','CZ',100) RETURNING id`)).rows[0].id;
  const E = (await o.query(`INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,title,date_start,slug)
    VALUES (gen_random_uuid(),$1,$2,$3,'E',now(),$4) RETURNING id`, [P, U0, V, 'ev-'+n])).rows[0].id;
  await o.query(`INSERT INTO orders.orders (id,user_id,event_id,total_amount,expires_at)
    SELECT gen_random_uuid(),u.id,$1,500,now()+interval '1 day'
    FROM (SELECT id FROM identity.users ORDER BY id LIMIT $2) u`, [E, n]);
  proms.push([n, P]);
}
await o.query(`ANALYZE identity.users; ANALYZE orders.orders; ANALYZE catalog.events;`);
await o.query(readFileSync(M453,'utf8'));
await o.end();

const Q = `SELECT DISTINCT u.id,u.email,u.name FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
  JOIN identity.users u ON u.id=o.user_id WHERE e.promoter_id=$1 ORDER BY u.id LIMIT 200`;
console.log('zákazníků │ stránka 200 řádků │ ms na zákazníka');
for (const [n, P] of proms) {
  const a = new pg.Client({ connectionString: clone.appUri, statement_timeout: 0 });
  await a.connect(); await a.query(`SET app.current_promoter_id='${P}'`); await a.query(`SET app.role='promoter'`);
  await a.query(`EXPLAIN (ANALYZE) ${Q}`, [P]);
  const r = await a.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${Q}`, [P]);
  const ms = r.rows[0]['QUERY PLAN'][0]['Execution Time'];
  console.log(`${String(n).padStart(9)} │ ${ms.toFixed(0).padStart(13)} ms │ ${(ms/n).toFixed(3)}`);
  await a.end();
}
