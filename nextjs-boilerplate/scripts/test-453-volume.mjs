#!/usr/bin/env node
/**
 * test-453-volume.mjs — výkon 453 na reálném objemu.
 *
 * §41 měřilo 200 zákazníků a 3 EXISTS větve. Aktuální 453 má větve ČTYŘI
 * (orders, tým, tickets, verified-fan) a na objemu nikdy neběžela.
 *
 * Data se ZÁMĚRNĚ rozprostírají přes stovky promotérů — kdyby všechno viselo
 * pod jedním, plánovač by viděl úplně jiné statistiky (n_distinct, korelace)
 * než produkce a plán by nebyl přenositelný.
 *
 *   NEON_API_KEY=... node scripts/test-453-volume.mjs clone.json
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const M453 = new URL('../../migrations/453_users_select_scoped.sql', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const N_USERS = 100_000;
const N_PROMOTERS = 200;
const N_EVENTS_PER = 2;
const N_ORDERS = 200_000;
const N_TICKETS = 300_000;

const owner = new pg.Client({ connectionString: clone.ownerUri, statement_timeout: 0 });
await owner.connect();
await owner.query(`SET statement_timeout = 0`);

const t0 = Date.now();
const step = async (label, sql) => {
  const t = Date.now();
  await owner.query(sql);
  console.log(`   ${label} — ${((Date.now() - t) / 1000).toFixed(1)} s`);
};

// Na seedovaných tabulkách visí `audit_trigger_func`, který na KAŽDÝ insert
// zapíše řádek do `audit.audit_log`. Při hromadném seedu to je násobek dat
// navíc — a Neon projekt má strop 512 MB (53100). Pro měření SELECT cest je
// audit irelevantní, tak ho na dobu seedu vypínáme (FK triggery zůstávají,
// `DISABLE TRIGGER USER` se jich netýká).
console.log('── vypnutí audit triggerů (jinak 53100: strop 512 MB) ──');
for (const t of ['identity.users','orders.orders','tickets.tickets','catalog.events',
                 'catalog.venues','platform.promoters','catalog.ticket_types',
                 'platform.promoter_members','marketing.verified_fan_requests',
                 'social_graph.friendships']) {
  await owner.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`).catch((e) => console.log(`   ${t}: ${e.code}`));
}

console.log('── seed ──');
await step('promotéři + místa', `
  INSERT INTO platform.promoters (id,name,email)
    SELECT gen_random_uuid(),'P'||g,'p'||g||'@v.cz' FROM generate_series(1,${N_PROMOTERS}) g;
  INSERT INTO catalog.venues (id,name,city,country,capacity)
    SELECT gen_random_uuid(),'V'||g,'Praha','CZ',5000 FROM generate_series(1,${N_PROMOTERS}) g;`);
await step('uživatelé', `
  INSERT INTO identity.users (id,email,name,gdpr_consent_at)
    SELECT gen_random_uuid(),'u'||g||'@v.cz','U'||g,now() FROM generate_series(1,${N_USERS}) g`);
await step('akce + typy lístků', `
  WITH p AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM platform.promoters),
       v AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM catalog.venues),
       u AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM identity.users)
  INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,title,date_start,slug)
  SELECT gen_random_uuid(),p.id,u.id,v.id,'E'||p.rn||'-'||s,now()+(s||' day')::interval,'ev-'||p.rn||'-'||s
  FROM p JOIN v ON v.rn=p.rn JOIN u ON u.rn=p.rn, generate_series(1,${N_EVENTS_PER}) s;
  INSERT INTO catalog.ticket_types (id,event_id,name,kind,base_price,total_qty,remaining_qty)
    SELECT gen_random_uuid(),e.id,'TT','standing',500,5000,5000 FROM catalog.events e;`);
await step('objednávky', `
  WITH u AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM identity.users),
       e AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM catalog.events),
       nu AS (SELECT count(*) c FROM identity.users), ne AS (SELECT count(*) c FROM catalog.events)
  INSERT INTO orders.orders (id,user_id,event_id,total_amount,expires_at)
  SELECT gen_random_uuid(),u.id,e.id,500,now()+interval '1 day'
  FROM generate_series(1,${N_ORDERS}) g JOIN nu ON true JOIN ne ON true
  JOIN u ON u.rn=1+(g%nu.c) JOIN e ON e.rn=1+((g*13)%ne.c)`);
await step('lístky (každý 5. dárek)', `
  WITH o AS (SELECT o.id,o.event_id,o.user_id,row_number() OVER (ORDER BY o.id) rn FROM orders.orders o),
       u AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM identity.users),
       nu AS (SELECT count(*) c FROM identity.users), no AS (SELECT count(*) c FROM orders.orders)
  INSERT INTO tickets.tickets (id,order_id,ticket_type_id,owner_id,original_owner_id,
                               totp_secret_encrypted,totp_secret_iv,original_price)
  SELECT gen_random_uuid(),o.id,tt.id,
         CASE WHEN g%5=0 THEN u.id ELSE o.user_id END, o.user_id,'\\x00','\\x00',500
  FROM generate_series(1,${N_TICKETS}) g JOIN no ON true JOIN nu ON true
  JOIN o ON o.rn=1+(g%no.c) JOIN u ON u.rn=1+((g*7)%nu.c)
  JOIN LATERAL (SELECT id FROM catalog.ticket_types WHERE event_id=o.event_id LIMIT 1) tt ON true`);
await step('tým + verified-fan + přátelství', `
  WITH p AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM platform.promoters),
       u AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM identity.users)
  INSERT INTO platform.promoter_members (promoter_id,user_id,role)
  SELECT p.id,u.id,'admin' FROM p JOIN u ON u.rn = p.rn + 500000 % 1 + p.rn*3;
  WITH e AS (SELECT id,promoter_id,row_number() OVER (ORDER BY id) rn FROM catalog.events),
       u AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM identity.users),
       nu AS (SELECT count(*) c FROM identity.users)
  INSERT INTO marketing.verified_fan_requests (user_id,event_id)
  SELECT u.id,e.id FROM e JOIN nu ON true JOIN u ON u.rn=1+((e.rn*29)%nu.c);
  WITH u AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM identity.users),
       nu AS (SELECT count(*) c FROM identity.users)
  INSERT INTO social_graph.friendships (user_a,user_b)
  SELECT LEAST(a.id,b.id),GREATEST(a.id,b.id)
  FROM generate_series(1,50000) g JOIN nu ON true
  JOIN u a ON a.rn=1+(g%nu.c) JOIN u b ON b.rn=1+((g*31)%nu.c)
  WHERE a.id<>b.id ON CONFLICT DO NOTHING;`);
await step('ANALYZE', `ANALYZE identity.users; ANALYZE orders.orders; ANALYZE catalog.events;
  ANALYZE tickets.tickets; ANALYZE platform.promoter_members;
  ANALYZE marketing.verified_fan_requests; ANALYZE social_graph.friendships;`);

const c = await owner.query(`SELECT
  (SELECT count(*) FROM identity.users) users,(SELECT count(*) FROM orders.orders) orders,
  (SELECT count(*) FROM tickets.tickets) tickets,(SELECT count(*) FROM catalog.events) events,
  (SELECT count(*) FROM platform.promoter_members) team,
  (SELECT count(*) FROM marketing.verified_fan_requests) vfan,
  (SELECT count(*) FROM social_graph.friendships) friends`);
console.log(`   ${JSON.stringify(c.rows[0])}  celkem ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// největší promotér + jeho reálný uživatel a jeden s přáteli
const P = (await owner.query(`SELECT e.promoter_id pid FROM catalog.events e JOIN orders.orders o ON o.event_id=e.id
  GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`)).rows[0].pid;
const nCust = (await owner.query(`SELECT count(DISTINCT o.user_id)::int n FROM orders.orders o
  JOIN catalog.events e ON e.id=o.event_id WHERE e.promoter_id=$1`, [P])).rows[0].n;
const BUYER = (await owner.query(`SELECT user_a id FROM social_graph.friendships LIMIT 1`)).rows[0].id;
console.log(`   největší promotér má ${nCust} zákazníků`);
await owner.end();

const QUERIES = [
  ['orders JOIN (63 sites), LIMIT 100', 'promoter',
    `SELECT u.id,u.email,u.name FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
     JOIN identity.users u ON u.id=o.user_id WHERE e.promoter_id=$1 LIMIT 100`],
  ['výpis zákazníků (stránka 200)', 'promoter',
    `SELECT DISTINCT u.id,u.email,u.name FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
     JOIN identity.users u ON u.id=o.user_id WHERE e.promoter_id=$1 ORDER BY u.id LIMIT 200`],
  ['scanner přes tickets', 'promoter',
    `SELECT u.id,u.name FROM tickets.tickets t JOIN orders.orders o ON o.id=t.order_id
     JOIN catalog.events e ON e.id=o.event_id JOIN identity.users u ON u.id=t.owner_id
     WHERE e.promoter_id=$1 LIMIT 100`],
  ['buyer: seznam přátel', 'buyer',
    `SELECT CASE WHEN f.user_a=$1 THEN f.user_b ELSE f.user_a END fid, u.email,u.name
     FROM social_graph.friendships f
     JOIN identity.users u ON u.id=(CASE WHEN f.user_a=$1 THEN f.user_b ELSE f.user_a END)
     WHERE f.user_a=$1 OR f.user_b=$1 LIMIT 500`],
];

async function run(label) {
  const out = {};
  for (const [name, ctx, sql] of QUERIES) {
    const app = new pg.Client({ connectionString: clone.appUri, statement_timeout: 0 });
    await app.connect();
    if (ctx === 'promoter') {
      await app.query(`SET app.current_promoter_id='${P}'`); await app.query(`SET app.role='promoter'`);
    } else {
      await app.query(`SET app.current_user_id='${BUYER}'`); await app.query(`SET app.role='buyer'`);
    }
    const param = ctx === 'promoter' ? P : BUYER;
    try {
      await app.query(`EXPLAIN (ANALYZE) ${sql}`, [param]); // zahřátí
      const r = await app.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, [param]);
      const plan = r.rows[0]['QUERY PLAN'][0];
      const walk = (n, a = []) => { a.push(n); (n.Plans || []).forEach((x) => walk(x, a)); return a; };
      const nodes = walk(plan.Plan);
      const seq = nodes.filter((n) => n['Node Type'] === 'Seq Scan' && n['Actual Loops'] > 0);
      out[name] = {
        ms: plan['Execution Time'], rows: plan.Plan['Actual Rows'],
        seq: seq.map((n) => `${n['Relation Name']}(loops=${n['Actual Loops']},rows=${n['Actual Rows']})`),
        idx: [...new Set(nodes.filter((n) => /Index/.test(n['Node Type'])).map((n) => n['Index Name']).filter(Boolean))],
      };
    } catch (e) { out[name] = { err: `${e.code} ${e.message.slice(0, 60)}` }; }
    await app.end();
  }
  console.log(`\n── ${label} ──`);
  for (const [n] of QUERIES) {
    const o = out[n];
    if (o.err) { console.log(`  ${n}: ERR ${o.err}`); continue; }
    console.log(`  ${n}`);
    console.log(`      ${o.ms.toFixed(1)} ms | ${o.rows} řádků | seq: ${o.seq.length ? o.seq.join(', ') : 'žádný'}`);
  }
  return out;
}

const BASE = await run('BASE (USING(true))');
const o2 = new pg.Client({ connectionString: clone.ownerUri });
await o2.connect(); await o2.query(readFileSync(M453, 'utf8')); await o2.end();
const R453 = await run('453 (self + promoter[4 EXISTS] + buyer)');

console.log('\n═══ VÝKON: BASE vs 453 ═══');
for (const [n] of QUERIES) {
  const b = BASE[n], a = R453[n];
  if (b.err || a.err) { console.log(`  ${n}: ERR`); continue; }
  console.log(`  ${n}`);
  console.log(`      ${b.ms.toFixed(1)} ms → ${a.ms.toFixed(1)} ms  (${(a.ms / b.ms).toFixed(1)}×) | řádků ${b.rows}→${a.rows}`);
  if (a.seq.length) console.log(`      🔴 SEQ SCAN: ${a.seq.join(', ')}`);
  else console.log(`      🟢 bez seq scanu | indexy: ${a.idx.slice(0, 6).join(', ')}`);
}
