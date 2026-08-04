#!/usr/bin/env node
/**
 * baseline-clone.mjs — postaví Neon větev a v NOVÉ PRÁZDNÉ databázi aplikuje
 * `000_baseline_20260730.sql` + `000_baseline_globals.sql`.
 *
 * ── Proč prázdná databáze ────────────────────────────────────────────────────
 * Neon větev se vždy klonuje z rodiče, takže by nesla produkční schéma a
 * neměřili bychom baseline, ale produkci. `CREATE DATABASE` dá skutečně
 * prázdný výchozí bod — tedy přesně to, co baseline tvrdí, že umí postavit.
 *
 * ── ⚠️ `\restrict` ───────────────────────────────────────────────────────────
 * Baseline je výstup `pg_dump` 17 a nese 2 psql meta-příkazy
 * (`\restrict` / `\unrestrict`). Přes node-pg dají `42601` a soubor se
 * NEAPLIKUJE VŮBEC. Tady je filtrujeme; produkční runner musí být `psql`,
 * nebo dělat totéž. Viz FINDINGS §33.
 *
 * ── Použití ──────────────────────────────────────────────────────────────────
 *   NEON_API_KEY=... node scripts/baseline-clone.mjs out.json
 *     REUSE_BRANCH=br-xxx   nevytvářej větev, použij existující
 *     GLOBALS=path          jiný soubor globals (pro ověření regenerace)
 *     SKIP_GLOBALS=1        aplikuj jen baseline
 *
 * Zapíše JSON s `branchId`, `ownerUri` a `appUri` (heslo pro `tixly_app`
 * se generuje za běhu — v souboru globals být nesmí).
 */
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const NEON_API = 'https://console.neon.tech/api/v2';
const PROJECT = 'fragrant-wildflower-75132205';
const PROD_BRANCH = 'br-rough-paper-alom0zky';
const NEW_DB = 'baseline_scan';
const MIG = new URL('../../migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const OUT = process.argv[2] || 'clone.json';

export async function neon(path, init = {}) {
  const res = await fetch(NEON_API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.NEON_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Neon API ${res.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

export async function connectRetry(uri) {
  let last;
  for (let i = 0; i < 6; i++) {
    const c = new pg.Client({ connectionString: uri, connectionTimeoutMillis: 30_000 });
    try {
      await c.connect();
      return c;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw last;
}

/** `\restrict` a `\unrestrict` jsou psql meta-příkazy, ne SQL. */
export const stripPsqlMeta = (sql) =>
  sql
    .split('\n')
    .filter((l) => !/^\\(un)?restrict\b/.test(l))
    .join('\n');

const t0 = Date.now();
let branchId = process.env.REUSE_BRANCH;
if (!branchId) {
  const created = await neon(`/projects/${PROJECT}/branches`, {
    method: 'POST',
    body: JSON.stringify({
      branch: { parent_id: PROD_BRANCH, name: `baseline-clone-${Date.now()}` },
      endpoints: [{ type: 'read_write' }],
    }),
  });
  branchId = created.branch.id;
  await new Promise((r) => setTimeout(r, 5000));
}
console.log(`[clone] větev ${branchId}`);

const { uri: adminUri } = await neon(
  `/projects/${PROJECT}/connection_uri?branch_id=${branchId}` +
    `&role_name=neondb_owner&database_name=neondb&pooled=false`,
);

let c = await connectRetry(adminUri);
await c.query(`DROP DATABASE IF EXISTS ${NEW_DB}`);
await c.query(`CREATE DATABASE ${NEW_DB}`);
await c.end();
console.log(`[clone] databáze ${NEW_DB} vytvořena (prázdná)`);

const baseUri = adminUri.replace(/\/neondb(\?|$)/, `/${NEW_DB}$1`);
c = await connectRetry(baseUri);

const files = ['000_baseline_20260730.sql'];
if (process.env.SKIP_GLOBALS !== '1') files.push(process.env.GLOBALS || '000_baseline_globals.sql');

for (const file of files) {
  const path = file.includes('/') || file.includes('\\') ? file : MIG + file;
  const t = Date.now();
  await c.query(stripPsqlMeta(readFileSync(path, 'utf8')));
  console.log(`[clone] ✅ ${file} (${Date.now() - t} ms)`);
}

const pw = `Clone_${randomUUID().slice(0, 12)}`;
await c.query(`ALTER ROLE tixly_app WITH PASSWORD '${pw}'`);

const q = async (sql) => (await c.query(sql)).rows[0].n;
const stats = {
  schemas: await q(
    `SELECT count(*)::int n FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname<>'information_schema'`,
  ),
  tables: await q(
    `SELECT count(*)::int n FROM pg_class WHERE relkind='r' AND relnamespace::regnamespace::text NOT IN ('pg_catalog','information_schema')`,
  ),
  policies: await q(`SELECT count(*)::int n FROM pg_policies`),
  rlsEnabled: await q(`SELECT count(*)::int n FROM pg_class WHERE relrowsecurity`),
};
await c.end();

const out = { branchId, db: NEW_DB, ownerUri: baseUri, appUri: baseUri.replace(/\/\/[^@]+@/, `//tixly_app:${pw}@`), stats, ms: Date.now() - t0 };
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`[clone] ${JSON.stringify(stats)} | ${out.ms} ms → ${OUT}`);
