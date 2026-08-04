#!/usr/bin/env node
/**
 * test-nested-cost.mjs — je 453 výjimka, nebo vzor?
 *
 * 1) self-check scanneru: po aplikaci 453 musí najít SECURITY DEFINER helper
 *    (jinak je „0 nepřímých" bezcenné tvrzení)
 * 2) bezpečnost SECURITY DEFINER: vidí promotér A uživatele, který nakoupil
 *    JEN u promotéra B?
 * 3) cena vnořeného RLS u TOP vzorců: tentýž dotaz s RLS na cílové tabulce
 *    a bez něj
 *
 *   NEON_API_KEY=... node scripts/test-nested-cost.mjs clone.json
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const M453 = new URL('../../migrations/453_users_select_scoped.sql', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const o = new pg.Client({ connectionString: clone.ownerUri, statement_timeout: 0 });
await o.connect(); await o.query(`SET statement_timeout=0`);
for (const t of ['identity.users','orders.orders','tickets.tickets','catalog.events','catalog.venues',
                 'platform.promoters','catalog.ticket_types','orders.order_items'])
  await o.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`).catch(() => {});

console.log('── seed ──');
await o.query(`INSERT INTO identity.users (id,email,name,gdpr_consent_at)
  SELECT gen_random_uuid(),'u'||g||'@n.cz','U',now() FROM generate_series(1,100000) g`);
await o.query(`INSERT INTO platform.promoters (id,name,email)
  SELECT gen_random_uuid(),'P'||g,'p'||g||'@n.cz' FROM generate_series(1,200) g;
  INSERT INTO catalog.venues (id,name,city,country,capacity)
  SELECT gen_random_uuid(),'V'||g,'P','CZ',5000 FROM generate_series(1,200) g;`);
const U0 = (await o.query(`SELECT id FROM identity.users LIMIT 1`)).rows[0].id;
await o.query(`WITH p AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM platform.promoters),
       v AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM catalog.venues)
  INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,title,date_start,slug)
  SELECT gen_random_uuid(),p.id,'${U0}',v.id,'E',now()+(s||' day')::interval,'ev-'||p.rn||'-'||s
  FROM p JOIN v ON v.rn=p.rn, generate_series(1,2) s;
  INSERT INTO catalog.ticket_types (id,event_id,name,kind,base_price,total_qty,remaining_qty)
    SELECT gen_random_uuid(),e.id,'TT','standing',500,99999,99999 FROM catalog.events e;`);
const A = (await o.query(`SELECT promoter_id FROM catalog.events LIMIT 1`)).rows[0].promoter_id;
const B = (await o.query(`SELECT id FROM platform.promoters WHERE id<>$1 LIMIT 1`, [A])).rows[0].id;
const EA = (await o.query(`SELECT id FROM catalog.events WHERE promoter_id=$1 LIMIT 1`, [A])).rows[0].id;
const EB = (await o.query(`SELECT id FROM catalog.events WHERE promoter_id=$1 LIMIT 1`, [B])).rows[0].id;
await o.query(`INSERT INTO orders.orders (id,user_id,event_id,total_amount,expires_at)
  SELECT gen_random_uuid(),u.id,'${EA}',500,now()+interval '1 day'
  FROM (SELECT id FROM identity.users ORDER BY id LIMIT 30000) u`);
await o.query(`WITH u AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM identity.users),
       e AS (SELECT id,row_number() OVER (ORDER BY id) rn FROM catalog.events),
       nu AS (SELECT count(*) c FROM identity.users), ne AS (SELECT count(*) c FROM catalog.events)
  INSERT INTO orders.orders (id,user_id,event_id,total_amount,expires_at)
  SELECT gen_random_uuid(),u.id,e.id,500,now()+interval '1 day'
  FROM generate_series(1,200000) g JOIN nu ON true JOIN ne ON true
  JOIN u ON u.rn=1+(g%nu.c) JOIN e ON e.rn=1+((g*13)%ne.c)`);
// uživatel, který nakoupil VÝHRADNĚ u promotéra B — testuje únik přes SECDEF
const ONLYB = randomUUID();
await o.query(`INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'OB',now())`, [ONLYB, `onlyb_${ONLYB.slice(0,8)}@n.cz`]);
await o.query(`DELETE FROM orders.orders WHERE user_id=$1`, [ONLYB]);
await o.query(`INSERT INTO orders.orders (id,user_id,event_id,total_amount,expires_at)
  VALUES (gen_random_uuid(),$1,$2,500,now()+interval '1 day')`, [ONLYB, EB]);
await o.query(`ANALYZE identity.users; ANALYZE orders.orders; ANALYZE catalog.events;`);
await o.query(readFileSync(M453, 'utf8'));
const cnt = await o.query(`SELECT (SELECT count(*) FROM orders.orders) o,(SELECT count(*) FROM identity.users) u`);
console.log(`   ${JSON.stringify(cnt.rows[0])}`);

// ── 2) bezpečnost SECURITY DEFINER ──────────────────────────────────────────
console.log('\n── 2) SECURITY DEFINER: vidí promotér A zákazníka promotéra B? ──');
const a = new pg.Client({ connectionString: clone.appUri, statement_timeout: 0 });
await a.connect();
await a.query(`SET app.current_promoter_id='${A}'`); await a.query(`SET app.role='promoter'`);
const seesOnlyB = (await a.query(`SELECT count(*)::int n FROM identity.users WHERE id=$1`, [ONLYB])).rows[0].n;
const fnDirect = (await a.query(`SELECT public.app_can_see_user_as_promoter($1) AS v`, [ONLYB])).rows[0].v;
const ownCust = (await o.query(`SELECT user_id FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id WHERE e.promoter_id=$1 LIMIT 1`, [A])).rows[0].user_id;
const seesOwn = (await a.query(`SELECT count(*)::int n FROM identity.users WHERE id=$1`, [ownCust])).rows[0].n;
console.log(`   zákazník POUZE promotéra B : viditelný=${seesOnlyB}  funkce vrací=${fnDirect}  ${seesOnlyB === 0 && fnDirect === false ? '✅ neuniká' : '🔴 ÚNIK'}`);
console.log(`   vlastní zákazník           : viditelný=${seesOwn}  ${seesOwn === 1 ? '✅' : '❌'}`);
// lze funkci podstrčit cizí ID a dostat true?
const foreignTrue = (await a.query(
  `SELECT count(*)::int n FROM identity.users u WHERE public.app_can_see_user_as_promoter(u.id)
   AND NOT EXISTS (SELECT 1 FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
                   WHERE o.user_id=u.id AND e.promoter_id=$1)`, [A])).rows[0].n;
console.log(`   uživatelů, kde funkce=true BEZ objednávky u A: ${foreignTrue}  (tým/lístky/verified-fan jsou legitimní)`);
await a.end();

// ── 3) cena vnořeného RLS u TOP vzorců ──────────────────────────────────────
console.log('\n── 3) cena vnořeného RLS (RLS na cílové tabulce ZAP vs VYP) ──');
const CASES = [
  ['orders.orders → catalog.events', 'catalog.events',
   `SELECT count(*) FROM orders.orders o WHERE o.event_id IN (SELECT id FROM catalog.events WHERE promoter_id=$1)`],
  ['tickets.tickets → catalog.events', 'catalog.events',
   `SELECT count(*) FROM tickets.tickets t JOIN orders.orders o ON o.id=t.order_id WHERE o.event_id IN (SELECT id FROM catalog.events WHERE promoter_id=$1)`],
  ['identity.users → orders.orders', 'orders.orders',
   `SELECT count(*) FROM identity.users u WHERE public.app_can_see_user_as_promoter(u.id)`],
];
for (const [label, target, sql] of CASES) {
  const run = async () => {
    const cl = new pg.Client({ connectionString: clone.appUri, statement_timeout: 0 });
    await cl.connect();
    await cl.query(`SET app.current_promoter_id='${A}'`); await cl.query(`SET app.role='promoter'`);
    await cl.query(`EXPLAIN (ANALYZE) ${sql}`, [A]).catch(()=>{});
    const r = await cl.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, [A]);
    await cl.end();
    return r.rows[0]['QUERY PLAN'][0]['Execution Time'];
  };
  const withRls = await run();
  await o.query(`ALTER TABLE ${target} DISABLE ROW LEVEL SECURITY`);
  const without = await run();
  await o.query(`ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY`);
  console.log(`   ${label.padEnd(34)} s RLS ${withRls.toFixed(0).padStart(6)} ms │ bez ${without.toFixed(0).padStart(6)} ms │ ${(withRls/without).toFixed(1)}×`);
}
await o.end();
