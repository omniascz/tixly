#!/usr/bin/env node
/**
 * test-454-cast.mjs — RED/GREEN pro migraci 454 (NULLIF místo přímého castu).
 *
 * Sondy pod `tixly_app` na všech 4 dotčených tabulkách, ve třech stavech GUC:
 *   PRÁZDNÝ   `SET app.current_user_id = ''`  → RED: 22P02
 *   PO RESET  `RESET app.current_user_id`     → RED: 22P02 (reálný stav z poolu)
 *   PLATNÝ    validní UUID                    → musí fungovat PŘED i PO
 *
 *   NEON_API_KEY=... node scripts/test-454-cast.mjs clone.json
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const MIG = new URL('../../migrations/454_rls_cast_nullif_fix.sql', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const TABLES = [
  'catalog.scanner_devices',
  'identity.oauth_accounts',
  'lineups.artist_follows',
];

const owner = new pg.Client({ connectionString: clone.ownerUri });
await owner.connect();
const USER = randomUUID();
await owner.query(`INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'U',now())`, [USER, `u_${USER.slice(0, 8)}@x.cz`]);

async function probe(label) {
  const res = {};
  for (const [state, setup] of [
    ['prázdný', `SET app.current_user_id = ''`],
    ['po RESET', `RESET app.current_user_id`],
    ['platný UUID', `SET app.current_user_id = '${USER}'`],
  ]) {
    const app = new pg.Client({ connectionString: clone.appUri });
    await app.connect();
    // nejdřív nastavit, pak (u varianty RESET) zase zrušit — přesně jak to
    // dělá pool, když vrátí spojení a resetuje kontext
    if (state === 'po RESET') await app.query(`SET app.current_user_id = '${USER}'`);
    await app.query(setup);
    for (const t of TABLES) {
      const key = `${t}|${state}`;
      try {
        await app.query(`SELECT count(*)::int n FROM ${t}`);
        res[key] = 'OK';
      } catch (e) {
        res[key] = e.code;
      }
    }
    await app.end();
  }
  console.log(`\n── ${label} ──`);
  console.log('tabulka                       prázdný   po RESET  platný UUID');
  for (const t of TABLES) {
    const c = (s) => {
      const v = res[`${t}|${s}`];
      return (v === '22P02' ? '🔴 22P02' : v === 'OK' ? '✅ OK   ' : `⚠️ ${v}`).padEnd(10);
    };
    console.log(`${t.padEnd(30)}${c('prázdný')}${c('po RESET')}${c('platný UUID')}`);
  }
  return res;
}

const red = await probe('RED — před migrací 454');
await owner.query(readFileSync(MIG, 'utf8'));
console.log('\n[mig] 454 aplikována');
const green = await probe('GREEN — po migraci 454');
await owner.end();

const redHas22 = TABLES.some((t) => red[`${t}|prázdný`] === '22P02' || red[`${t}|po RESET`] === '22P02');
const greenClean = TABLES.every((t) =>
  ['prázdný', 'po RESET', 'platný UUID'].every((s) => green[`${t}|${s}`] === 'OK'),
);
console.log(`\nRED  obsahuje 22P02          : ${redHas22 ? 'ANO ✅ (chyba doložena)' : 'NE ❌'}`);
console.log(`GREEN je bez chyb ve všech 3 : ${greenClean ? 'ANO ✅' : 'NE ❌'}`);
console.log(`\n═══ ${redHas22 && greenClean ? '✅ RED→GREEN POTVRZENO' : '❌ NEPOTVRZENO'} ═══`);
process.exit(redHas22 && greenClean ? 0 : 1);
