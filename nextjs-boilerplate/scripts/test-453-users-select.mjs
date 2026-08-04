#!/usr/bin/env node
/**
 * test-453-users-select.mjs — RED/GREEN pro migraci 453 (zúžení p_users_select).
 *
 * RED   = před migrací: tenant A vidí řádek tenanta B (dnešní stav)
 * GREEN = po migraci:   A řádek B NEVIDÍ, ale nerozbily se legitimní cesty:
 *           • login          (service kontext, JOIN user_secrets)
 *           • guest-create   (createOrGetGuestUser → INSERT ON CONFLICT)
 *           • admin výpis    (promotér vidí své zákazníky přes orders→events)
 *           • vlastní řádek  (/api/my/*)
 *
 *   NEON_API_KEY=... node scripts/test-453-users-select.mjs clone.json
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const MIG = new URL('../../migrations/453_users_select_scoped.sql', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const owner = new pg.Client({ connectionString: clone.ownerUri });
await owner.connect();

const A = { promoter: randomUUID(), user: randomUUID(), event: randomUUID(), venue: randomUUID(), order: randomUUID() };
const B = { promoter: randomUUID(), user: randomUUID(), event: randomUUID(), venue: randomUUID(), order: randomUUID() };
const MEMBER = randomUUID(); // člen týmu promotéra A
const STRANGER = randomUUID(); // nikdo — nesmí být vidět

async function seed(t) {
  await owner.query(`INSERT INTO platform.promoters (id,name,email) VALUES ($1,$2,$3)`, [t.promoter, 'P_' + t.promoter.slice(0, 6), `p${t.promoter.slice(0, 6)}@x.cz`]);
  await owner.query(`INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,$3,now())`, [t.user, `u${t.user.slice(0, 6)}@x.cz`, 'U']);
  await owner.query(
    `INSERT INTO catalog.venues (id,name,city,country,capacity) VALUES ($1,'V','Praha','CZ',100)`,
    [t.venue],
  );
  await owner.query(
    `INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,title,date_start,slug)
     VALUES ($1,$2,$3,$4,'E',now(),$5)`,
    [t.event, t.promoter, t.user, t.venue, 'ev-' + t.event.slice(0, 8)],
  );
  await owner.query(
    `INSERT INTO orders.orders (id,user_id,event_id,total_amount,expires_at)
     VALUES ($1,$2,$3,100,now() + interval '1 day')`,
    [t.order, t.user, t.event],
  );
}

console.log('── seed ──');
for (const t of [A, B]) await seed(t).catch((e) => console.log('seed', e.code, e.message.slice(0, 120)));
await owner.query(`INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'M',now())`, [MEMBER, `m_${MEMBER.slice(0, 8)}@x.cz`]);
await owner.query(`INSERT INTO platform.promoter_members (promoter_id,user_id,role) VALUES ($1,$2,'admin')`, [A.promoter, MEMBER]).catch((e) => console.log('member', e.code));
await owner.query(`INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'S',now())`, [STRANGER, `s_${STRANGER.slice(0, 8)}@x.cz`]);
// heslo pro login test — trigger ho přesune do user_secrets
await owner.query(`UPDATE identity.users SET password_hash='$2b$10$fakehashfakehashfakehashfakehashfakehashfakehashfake' WHERE id=$1`, [A.user]);
const inSecrets = (await owner.query(`SELECT count(*)::int n FROM identity.user_secrets WHERE user_id=$1`, [A.user])).rows[0].n;
const inUsers = (await owner.query(`SELECT password_hash FROM identity.users WHERE id=$1`, [A.user])).rows[0].password_hash;
console.log(`   trigger: hash v user_secrets=${inSecrets}, v users=${inUsers === null ? 'NULL ✅' : 'STÁLE TAM ❌'}`);

/** Připojí se jako tixly_app v daném kontextu a vrátí sondy. */
async function probe(label) {
  const out = {};
  const asPromoterA = new pg.Client({ connectionString: clone.appUri });
  await asPromoterA.connect();
  await asPromoterA.query(`SET app.current_promoter_id = '${A.promoter}'`);
  await asPromoterA.query(`SET app.role = 'promoter'`);
  // cizí tenant
  out.vidiB = (await asPromoterA.query(`SELECT count(*)::int n FROM identity.users WHERE id=$1`, [B.user])).rows[0].n;
  // vlastní zákazník (admin výpis přes orders→events)
  out.vidiSvehoZakaznika = (await asPromoterA.query(`SELECT count(*)::int n FROM identity.users WHERE id=$1`, [A.user])).rows[0].n;
  // člen týmu
  out.vidiClena = (await asPromoterA.query(`SELECT count(*)::int n FROM identity.users WHERE id=$1`, [MEMBER])).rows[0].n;
  // úplně cizí člověk
  out.vidiCizihoCloveka = (await asPromoterA.query(`SELECT count(*)::int n FROM identity.users WHERE id=$1`, [STRANGER])).rows[0].n;
  // reálný admin JOIN (tvar, jaký jede v 126 routách)
  out.adminJoin = (
    await asPromoterA.query(
      `SELECT count(*)::int n FROM orders.orders o
       JOIN catalog.events e ON e.id=o.event_id
       JOIN identity.users u ON u.id=o.user_id
       WHERE e.promoter_id=$1`,
      [A.promoter],
    )
  ).rows[0].n;
  await asPromoterA.end();

  // login = service kontext
  const svc = new pg.Client({ connectionString: clone.appUri });
  await svc.connect();
  await svc.query(`SET app.role = 'service'`);
  out.login = (
    await svc.query(
      `SELECT count(*)::int n FROM identity.users u JOIN identity.user_secrets s ON s.user_id=u.id WHERE u.id=$1`,
      [A.user],
    )
  ).rows[0].n;
  // guest-create: ON CONFLICT DO UPDATE musí projít i USING
  const gEmail = `guest_${randomUUID().slice(0, 8)}@x.cz`;
  try {
    await svc.query(
      `INSERT INTO identity.users (email,name,gdpr_consent_at) VALUES ($1,'G',now())
       ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE SET name=EXCLUDED.name RETURNING id`,
      [gEmail],
    );
    out.guestCreate = 'OK';
  } catch (e) {
    out.guestCreate = `${e.code}`;
  }
  await svc.end();

  // vlastní řádek (buyer)
  const buyer = new pg.Client({ connectionString: clone.appUri });
  await buyer.connect();
  await buyer.query(`SET app.current_user_id = '${B.user}'`);
  await buyer.query(`SET app.role = 'buyer'`);
  out.vlastniRadek = (await buyer.query(`SELECT count(*)::int n FROM identity.users WHERE id=$1`, [B.user])).rows[0].n;
  await buyer.end();

  console.log(`\n── ${label} ──`);
  console.log(`  promotér A vidí řádek tenanta B  : ${out.vidiB}   ${out.vidiB === 0 ? '✅ izolováno' : '🔴 ÚNIK'}`);
  console.log(`  promotér A vidí cizího člověka   : ${out.vidiCizihoCloveka}   ${out.vidiCizihoCloveka === 0 ? '✅' : '🔴 ÚNIK'}`);
  console.log(`  promotér A vidí svého zákazníka  : ${out.vidiSvehoZakaznika}   ${out.vidiSvehoZakaznika === 1 ? '✅ funguje' : '❌ ROZBITO'}`);
  console.log(`  promotér A vidí člena svého týmu : ${out.vidiClena}   ${out.vidiClena === 1 ? '✅ funguje' : '❌ ROZBITO'}`);
  console.log(`  admin JOIN (126 routes tvar)     : ${out.adminJoin}   ${out.adminJoin >= 1 ? '✅ funguje' : '❌ ROZBITO'}`);
  console.log(`  login (service + user_secrets)   : ${out.login}   ${out.login === 1 ? '✅ funguje' : '❌ ROZBITO'}`);
  console.log(`  guest-create ON CONFLICT         : ${out.guestCreate} ${out.guestCreate === 'OK' ? '✅' : '❌ ROZBITO'}`);
  console.log(`  buyer vidí vlastní řádek         : ${out.vlastniRadek}   ${out.vlastniRadek === 1 ? '✅ funguje' : '❌ ROZBITO'}`);
  return out;
}

const red = await probe('RED — před migrací 453 (dnešní stav)');
await owner.query(readFileSync(MIG, 'utf8'));
console.log('\n[mig] 453 aplikována');
const green = await probe('GREEN — po migraci 453');
await owner.end();

const ok =
  red.vidiB === 1 &&
  green.vidiB === 0 &&
  green.vidiCizihoCloveka === 0 &&
  green.vidiSvehoZakaznika === 1 &&
  green.vidiClena === 1 &&
  green.adminJoin >= 1 &&
  green.login === 1 &&
  green.guestCreate === 'OK' &&
  green.vlastniRadek === 1;
console.log(`\n═══ ${ok ? '✅ RED→GREEN POTVRZENO' : '❌ NEPOTVRZENO'} ═══`);
process.exit(ok ? 0 : 1);
