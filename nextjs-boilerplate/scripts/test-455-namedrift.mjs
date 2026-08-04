#!/usr/bin/env node
/**
 * test-455-namedrift.mjs — RED/GREEN pro migraci 455.
 *
 * Cíl: tabulky, kde aplikace dnes NEVIDÍ ANI VLASTNÍ DATA, protože policy čte
 * GUC jméno, které `rls-pool` nenastavuje (§34, §38). Po 455 má vlastní řádek
 * být vidět — a cizí NE.
 *
 * Měří se v obou kontextech (§43): promotérské tabulky pod promotérem,
 * uživatelské pod buyerem.
 *
 *   NEON_API_KEY=... node scripts/test-455-namedrift.mjs clone.json
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const MIG = new URL('../../migrations/455_rls_namedrift_identity.sql', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const owner = new pg.Client({ connectionString: clone.ownerUri });
await owner.connect();

const A = { promoter: randomUUID(), event: randomUUID(), venue: randomUUID(), user: randomUUID() };
const B = { promoter: randomUUID(), event: randomUUID(), venue: randomUUID(), user: randomUUID() };

for (const t of [A, B]) {
  await owner.query(`INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'U',now())`, [t.user, `u_${t.user.slice(0, 8)}@x.cz`]);
  await owner.query(`INSERT INTO platform.promoters (id,name,email) VALUES ($1,$2,$3)`, [t.promoter, 'P' + t.promoter.slice(0, 5), `p${t.promoter.slice(0, 6)}@x.cz`]);
  await owner.query(`INSERT INTO catalog.venues (id,name,city,country,capacity) VALUES ($1,'V','Praha','CZ',100)`, [t.venue]);
  await owner.query(`INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,title,date_start,slug)
     VALUES ($1,$2,$3,$4,'E',now(),$5)`, [t.event, t.promoter, t.user, t.venue, 'ev-' + t.event.slice(0, 8)]);
}

// ── cílové tabulky: (schéma.tabulka, kontext, INSERT sloupce podle tenanta) ──
const CASES = [
  // promoter_id je tady TEXT, ne uuid — proto policy porovnávala textově
  // a generátor správně vyrobil (app_current_promoter_id())::text
  ['payments.wero_payments', 'promoter', (t) => [`(id,order_id,promoter_id,amount_halire)`, `($1,$2,$3,100)`, [randomUUID(), randomUUID(), t.promoter]]],
  ['catalog.event_sponsors', 'promoter', (t) => [`(id,event_id,name)`, `($1,$2,'S')`, [randomUUID(), t.event]]],
  ['identity.magic_link_tokens', 'buyer', (t) => [`(id,user_id,token_hash,expires_at)`, `($1,$2,$3,now()+interval '1 h')`, [randomUUID(), t.user, 'h_' + randomUUID().slice(0, 8)]]],
];

const seeded = [];
for (const [tbl, ctx, mk] of CASES) {
  let ok = true;
  for (const t of [A, B]) {
    const [cols, vals, params] = mk(t);
    try { await owner.query(`INSERT INTO ${tbl} ${cols} VALUES ${vals}`, params); }
    catch (e) { console.log(`  [seed] ${tbl}: ${e.code} ${e.message.slice(0, 80)}`); ok = false; break; }
  }
  if (ok) seeded.push([tbl, ctx]);
}

async function measure(label) {
  const res = {};
  for (const [tbl, ctx] of seeded) {
    const app = new pg.Client({ connectionString: clone.appUri });
    await app.connect();
    if (ctx === 'promoter') {
      await app.query(`SET app.current_promoter_id='${A.promoter}'`);
      await app.query(`SET app.role='promoter'`);
    } else {
      await app.query(`SET app.current_user_id='${A.user}'`);
      await app.query(`SET app.role='buyer'`);
    }
    try { res[tbl] = (await app.query(`SELECT count(*)::int n FROM ${tbl}`)).rows[0].n; }
    catch (e) { res[tbl] = `ERR ${e.code}`; }
    await app.end();
  }
  console.log(`\n── ${label} ──`);
  for (const [tbl, ctx] of seeded) console.log(`  ${String(res[tbl]).padStart(4)}  ${tbl}  (${ctx})`);
  return res;
}

const red = await measure('RED — před 455 (GUC jméno nikdo nenastaví)');
await owner.query(readFileSync(MIG, 'utf8'));
console.log('\n[mig] 455 aplikována');
const green = await measure('GREEN — po 455');
await owner.end();

console.log('\n═══ VERDIKT ═══  (2 řádky v tabulce: vlastní + cizí)');
let fixed = 0, leaks = 0;
for (const [tbl] of seeded) {
  const r = red[tbl], g = green[tbl];
  let v;
  if (g === 2) { v = '🔴 ÚNIK (vidí i cizí)'; leaks++; }
  else if (r === 0 && g === 1) { v = '✅ OPRAVENO (vidí vlastní, cizí ne)'; fixed++; }
  else if (g === 1) v = '✅ vidí vlastní';
  else v = `⚪ beze změny (${r}→${g})`;
  console.log(`  ${r} → ${g}  ${v}   ${tbl}`);
}
console.log(`\nopraveno: ${fixed} | úniků: ${leaks}`);
console.log(`\n═══ ${fixed > 0 && leaks === 0 ? '✅ RED→GREEN POTVRZENO' : '❌ NEPOTVRZENO'} ═══`);
process.exit(fixed > 0 && leaks === 0 ? 0 : 1);
