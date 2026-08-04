#!/usr/bin/env node
/**
 * test-453-isolate.mjs — po kterém KROKU seedu se objeví propad?
 *
 * §45: 100k users / 200k orders / 300k tickets → 18 643 ms
 * §46: 30k users, 0 lístků                     →      37 ms
 * Rozdíl je v datech, ne v počtu zákazníků (křivka byla plochá).
 *
 * Seeduje přírůstkově a po KAŽDÉM kroku měří tentýž dotaz. Krok, po kterém
 * čas skočí, je viník.
 *
 * bytea se generuje v SQL přes decode(…,'hex') — předávání '\x00' z Node
 * minule skončilo na 08P01 invalid message format.
 *
 *   NEON_API_KEY=... node scripts/test-453-isolate.mjs clone.json
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const M453 = new URL('../../migrations/453_users_select_scoped.sql', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const N_USERS = 100_000;
const N_PROMOTERS = 200;
const BIG_CUSTOMERS = 30_000;
const N_SPREAD_ORDERS = 200_000;
const N_TICKETS = 300_000;

const o = new pg.Client({ connectionString: clone.ownerUri, statement_timeout: 0 });
await o.connect();
await o.query(`SET statement_timeout=0`);
for (const t of ['identity.users','orders.orders','tickets.tickets','catalog.events','catalog.venues',
                 'platform.promoters','catalog.ticket_types','marketing.verified_fan_requests',
                 'social_graph.friendships','platform.promoter_members'])
  await o.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`).catch(() => {});

let BIG = null;
const Q = `SELECT DISTINCT u.id,u.email,u.name FROM orders.orders o
  JOIN catalog.events e ON e.id=o.event_id JOIN identity.users u ON u.id=o.user_id
  WHERE e.promoter_id=$1 ORDER BY u.id LIMIT 200`;

async function measure(label, explain = false) {
  const a = new pg.Client({ connectionString: clone.appUri, statement_timeout: 0 });
  await a.connect();
  await a.query(`SET app.current_promoter_id='${BIG}'`);
  await a.query(`SET app.role='promoter'`);
  await a.query(`EXPLAIN (ANALYZE) ${Q}`, [BIG]); // zahřátí
  const r = await a.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${Q}`, [BIG]);
  const p = r.rows[0]['QUERY PLAN'][0];
  const ms = p['Execution Time'];
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(0).padStart(7)} ms`);
  if (explain) {
    const walk = (n, acc = []) => { acc.push(n); (n.Plans || []).forEach((c) => walk(c, acc)); return acc; };
    const nodes = walk(p.Plan);
    for (const n of nodes) {
      if (!/Scan/.test(n['Node Type'])) continue;
      if ((n['Actual Loops'] ?? 0) === 0) continue;
      console.log(`        ${n['Node Type']} ${n['Relation Name'] ?? n['Index Name'] ?? ''}` +
        ` loops=${n['Actual Loops']} rows=${n['Actual Rows']}` +
        ` shared_hit=${n['Shared Hit Blocks'] ?? 0}` + (n['Filter'] ? ` filter=${String(n['Filter']).slice(0, 60)}` : ''));
    }
  }
  await a.end();
  return ms;
}

const step = async (label, sql) => { const t = Date.now(); await o.query(sql); console.log(`   [seed] ${label} — ${((Date.now()-t)/1000).toFixed(1)} s`); };

// ── KROK 1: uživatelé + velký promotér s 30k zákazníky ──────────────────────
await step('uživatelé', `INSERT INTO identity.users (id,email,name,gdpr_consent_at)
  SELECT gen_random_uuid(),'u'||g||'@i.cz','U',now() FROM generate_series(1,${N_USERS}) g`);
await step('promotéři + místa', `
  INSERT INTO platform.promoters (id,name,email)
    SELECT gen_random_uuid(),'P'||g,'p'||g||'@i.cz' FROM generate_series(1,${N_PROMOTERS}) g;
  INSERT INTO catalog.venues (id,name,city,country,capacity)
    SELECT gen_random_uuid(),'V'||g,'P','CZ',5000 FROM generate_series(1,${N_PROMOTERS}) g;`);
const U0 = (await o.query(`SELECT id FROM identity.users LIMIT 1`)).rows[0].id;
await step('akce', `
  WITH p AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM platform.promoters),
       v AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM catalog.venues)
  INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,title,date_start,slug)
  SELECT gen_random_uuid(),p.id,'${U0}',v.id,'E',now()+(s||' day')::interval,'ev-'||p.rn||'-'||s
  FROM p JOIN v ON v.rn=p.rn, generate_series(1,2) s;
  INSERT INTO catalog.ticket_types (id,event_id,name,kind,base_price,total_qty,remaining_qty)
    SELECT gen_random_uuid(),e.id,'TT','standing',500,99999,99999 FROM catalog.events e;`);
BIG = (await o.query(`SELECT promoter_id FROM catalog.events LIMIT 1`)).rows[0].promoter_id;
const BIGE = (await o.query(`SELECT id FROM catalog.events WHERE promoter_id=$1 LIMIT 1`, [BIG])).rows[0].id;
await step(`objednávky velkého promotéra (${BIG_CUSTOMERS})`, `
  INSERT INTO orders.orders (id,user_id,event_id,total_amount,expires_at)
  SELECT gen_random_uuid(),u.id,'${BIGE}',500,now()+interval '1 day'
  FROM (SELECT id FROM identity.users ORDER BY id LIMIT ${BIG_CUSTOMERS}) u`);
await o.query(`ANALYZE identity.users; ANALYZE orders.orders; ANALYZE catalog.events;`);
await o.query(readFileSync(M453, 'utf8'));
console.log('\n[mig] 453 aplikována\n── měření po krocích ──');
const m1 = await measure('1. users + big orders');

// ── KROK 2: rozprostřené objednávky ─────────────────────────────────────────
await step('rozprostřené objednávky', `
  WITH u AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM identity.users),
       e AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM catalog.events),
       nu AS (SELECT count(*) c FROM identity.users), ne AS (SELECT count(*) c FROM catalog.events)
  INSERT INTO orders.orders (id,user_id,event_id,total_amount,expires_at)
  SELECT gen_random_uuid(),u.id,e.id,500,now()+interval '1 day'
  FROM generate_series(1,${N_SPREAD_ORDERS}) g JOIN nu ON true JOIN ne ON true
  JOIN u ON u.rn=1+(g%nu.c) JOIN e ON e.rn=1+((g*13)%ne.c)`);
await o.query(`ANALYZE orders.orders`);
const m2 = await measure('2. + rozprostřené objednávky');

// ── KROK 3: lístky (bytea přes decode v SQL, ne z Node) ─────────────────────
await step('lístky', `
  WITH ord AS (SELECT o.id,o.event_id,o.user_id,row_number() OVER (ORDER BY o.id) rn FROM orders.orders o),
       no AS (SELECT count(*) c FROM orders.orders),
       u AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM identity.users),
       nu AS (SELECT count(*) c FROM identity.users)
  INSERT INTO tickets.tickets (id,order_id,ticket_type_id,owner_id,original_owner_id,
                               totp_secret_encrypted,totp_secret_iv,original_price)
  SELECT gen_random_uuid(),ord.id,tt.id,
         CASE WHEN g%5=0 THEN u.id ELSE ord.user_id END, ord.user_id,
         decode('00','hex'), decode('00','hex'), 500
  FROM generate_series(1,${N_TICKETS}) g JOIN no ON true JOIN nu ON true
  JOIN ord ON ord.rn=1+(g%no.c) JOIN u ON u.rn=1+((g*7)%nu.c)
  JOIN LATERAL (SELECT id FROM catalog.ticket_types WHERE event_id=ord.event_id LIMIT 1) tt ON true`);
await o.query(`ANALYZE tickets.tickets`);
const m3 = await measure('3. + lístky', true);

// ── KROK 4: verified-fan ────────────────────────────────────────────────────
await step('verified-fan', `
  WITH e AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM catalog.events),
       u AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM identity.users),
       nu AS (SELECT count(*) c FROM identity.users)
  INSERT INTO marketing.verified_fan_requests (user_id,event_id)
  SELECT u.id,e.id FROM e JOIN nu ON true JOIN u ON u.rn=1+((e.rn*29)%nu.c)`);
await o.query(`ANALYZE marketing.verified_fan_requests`);
const m4 = await measure('4. + verified-fan');

// ── KROK 5: přátelství ──────────────────────────────────────────────────────
await step('přátelství', `
  WITH u AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM identity.users),
       nu AS (SELECT count(*) c FROM identity.users)
  INSERT INTO social_graph.friendships (user_a,user_b)
  SELECT LEAST(a.id,b.id),GREATEST(a.id,b.id) FROM generate_series(1,50000) g JOIN nu ON true
  JOIN u a ON a.rn=1+(g%nu.c) JOIN u b ON b.rn=1+((g*31)%nu.c)
  WHERE a.id<>b.id ON CONFLICT DO NOTHING`);
await o.query(`ANALYZE social_graph.friendships`);
const m5 = await measure('5. + přátelství');
await o.end();

console.log('\n═══ SKOK ═══');
const ms = [['1 users+big orders',m1],['2 +rozprostřené orders',m2],['3 +lístky',m3],['4 +verified-fan',m4],['5 +přátelství',m5]];
let prev = null;
for (const [l, v] of ms) {
  const f = prev ? ` (${(v/prev).toFixed(1)}× proti předchozímu)` : '';
  console.log(`  ${l.padEnd(26)} ${v.toFixed(0).padStart(7)} ms${f}`);
  prev = v;
}
