#!/usr/bin/env node
/**
 * scan-connect-tx-shape.mjs — kdo by se rozbil, kdyby `connect()` otevrel
 * transakci sam (kandidat (c) u R-56).
 *
 * Zmereno (§192): vnoreny `BEGIN` je jen WARNING, ale **`SET LOCAL` konci
 * s prvnim `COMMIT`em volajiciho** — 3 ze 3 opakovani, `app.role` po COMMITu
 * prazdny. Kdyby tedy `connect()` nastavil GUC pres `SET LOCAL` ve vlastni
 * transakci, kazdy dotaz, ktery volajici posle PO svem COMMITu, by bezel
 * BEZ kontextu.
 *
 * Tenhle sken hleda prave ty volajici. Pro kazde `db().connect()` vezme telo
 * az po odpovidajici `release()` a hlasi:
 *   BEGIN?  COMMIT?  kolik COMMITu  dotaz PO poslednim COMMITu?
 *
 * SELF-CHECK (§54): na dvou vestavenych vzorcich — jeden s dotazem po COMMITu
 * (musi najit) a jeden bez nej (nesmi najit). Kdyz self-check neprojde,
 * skript skonci exit 3 a jeho cisla NEPLATI.
 *
 *   node scripts/scan-connect-tx-shape.mjs [--root=src]
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const rootArg = (process.argv.find((a) => a.startsWith('--root=')) ?? '--root=src').split('=')[1];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const CONNECT = /\b(?:db|appDb)\(\)\.connect\(\)/g;

/**
 * Telo od `connect()` po `release()`. Kdyz `release()` chybi, bere se zbytek
 * souboru — radsi prehlasit nez podhlasit.
 */
function regionAfter(src, from) {
  const rel = src.indexOf('.release(', from);
  return src.slice(from, rel === -1 ? src.length : rel);
}

function classify(region) {
  const begins = (region.match(/['"`]BEGIN\b/gi) ?? []).length;
  const commitIdx = [...region.matchAll(/['"`]COMMIT\b/gi)].map((m) => m.index);
  const commits = commitIdx.length;
  let queryAfterCommit = false;
  if (commits) {
    const tail = region.slice(commitIdx[commitIdx.length - 1] + 6);
    // Uklidove `query('ROLLBACK')` v catch vetvi se nepocita — musi vypadnout
    // CELE volani, ne jen retezec, jinak zbyle `.query(` pred nim dela
    // falesny nalez (na tomhle self-check napoprve spadl).
    queryAfterCommit = /\.query\s*[(<]/.test(
      tail.replace(/\.query\s*\(\s*['"`]ROLLBACK\b[^)]*\)/gi, ''),
    );
  }
  return { begins, commits, queryAfterCommit };
}

// ── SELF-CHECK ──────────────────────────────────────────────────────────────
const POS = `
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE x SET y = 1');
    await client.query('COMMIT');
    const r = await client.query('SELECT * FROM z');
    return r;
  } finally { client.release(); }
`;
const NEG = `
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE x SET y = 1');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
  } finally { client.release(); }
`;
const posHit = classify(regionAfter(POS, POS.indexOf('connect()'))).queryAfterCommit;
const negHit = classify(regionAfter(NEG, NEG.indexOf('connect()'))).queryAfterCommit;
if (!posHit || negHit) {
  console.error(`SELF-CHECK SELHAL (pozitivni=${posHit}, negativni=${negHit}) -> cisla NEPLATI.`);
  process.exit(3);
}
console.log('SELF-CHECK OK: vzor s dotazem po COMMITu nalezen, vzor bez nej ne.\n');

// ── SKEN ────────────────────────────────────────────────────────────────────
const files = walk(rootArg);
let sites = 0, withBegin = 0, noBegin = 0, multiCommit = 0;
const risky = [];

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(CONNECT)) {
    sites++;
    const c = classify(regionAfter(src, m.index));
    if (c.begins) withBegin++; else noBegin++;
    if (c.commits > 1) multiCommit++;
    if (c.queryAfterCommit) risky.push(relative(process.cwd(), f).replace(/\\/g, '/'));
  }
}

console.log(`volani db().connect()          : ${sites}`);
console.log(`  z toho s vlastnim BEGIN      : ${withBegin}`);
console.log(`  z toho BEZ BEGIN             : ${noBegin}`);
console.log(`  s vice nez jednim COMMITem   : ${multiCommit}`);
console.log(`\nDOTAZ PO COMMITu (rozbil by je kandidat (c)): ${risky.length} volani`);
const uniq = [...new Set(risky)].sort();
console.log(`v ${uniq.length} souborech:`);
for (const f of uniq) console.log('  ', f);
