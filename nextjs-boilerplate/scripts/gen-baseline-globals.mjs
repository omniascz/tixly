#!/usr/bin/env node
/**
 * gen-baseline-globals.mjs — vygeneruje `000_baseline_globals.sql` z reálného
 * schématu (klon s aplikovaným baseline).
 *
 * ── ⚠️ Nečte ACL z produkce ──────────────────────────────────────────────────
 * Původní globals vznikly opsáním produkčních ACL (`nspacl` / `relacl`).
 * Právě proto v nich CHYBĚLA schémata `communications` a `brands` — na
 * produkci grant nemají, takže se do souboru nepropsala a aplikace na ně
 * pod `tixly_app` dostávala `42501` (FINDINGS §26, §33).
 *
 * Generátor proto vyjadřuje ZÁMĚR, ne stav produkce: udělí grant na VŠECHNA
 * uživatelská schémata a všechny jejich tabulky/pohledy/sekvence.
 *
 * ── Co se VYNECHÁVÁ a proč ───────────────────────────────────────────────────
 * Objekty vlastněné extensionou (`pg_depend.deptype='e'`) — typicky PostGIS
 * (`geography_columns`, `geometry_columns`, `spatial_ref_sys`). Ty vlastní
 * `cloud_admin`; `neondb_owner` na ně grant udělit NEMŮŽE a Postgres vrátí
 * jen WARNING „no privileges were granted", NE error — takže by to neodhalil
 * ani `ON_ERROR_STOP=1`.
 *
 * ── Pojistka ─────────────────────────────────────────────────────────────────
 * Skript SPADNE, pokud vygeneruje MÉNĚ položek, než kolik jich má předchozí
 * verze souboru. Granty se smí jen rozšiřovat vědomě, nikdy tiše ubývat.
 *
 *   NEON_API_KEY=... node scripts/gen-baseline-globals.mjs clone.json
 *     --write   zapiš do migrations/000_baseline_globals.sql
 */
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const WRITE = process.argv.includes('--write');
const TARGET = new URL('../../migrations/000_baseline_globals.sql', import.meta.url).pathname.replace(
  /^\/([A-Z]:)/,
  '$1',
);

const c = new pg.Client({ connectionString: clone.ownerUri });
await c.connect();

const NOT_EXT = `NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype='e')`;

const schemas = (
  await c.query(`SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' ORDER BY 1`)
).rows.map((r) => r.nspname);

// `ON TABLE` platí i pro pohledy a matview — proto relkind IN (r,p,v,m,f).
const tables = (
  await c.query(`SELECT n.nspname, c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p','v','m','f')
      AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
      AND ${NOT_EXT}
    ORDER BY 1,2`)
).rows;

const seqs = (
  await c.query(`SELECT n.nspname, c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
      AND ${NOT_EXT}
    ORDER BY 1,2`)
).rows;
await c.end();

const L = [];
L.push('--');
L.push('-- 000_baseline_globals.sql — role, granty, default privileges');
L.push('--');
L.push('-- 000_baseline_20260730.sql byl pořízen s `--no-owner --no-privileges`,');
L.push('-- takže NEobsahuje ani roli `tixly_app`, ani jediný GRANT. Bez tohohle');
L.push('-- souboru vznikne kompletní schéma včetně 596 RLS policies a aplikace');
L.push('-- se přesto nedostane k jedinému řádku.');
L.push('--');
L.push('-- POŘADÍ: tenhle soubor se pouští AŽ PO 000_baseline_20260730.sql —');
L.push('-- granty se udělují na objekty, které musí existovat dřív.');
L.push('-- Výjimka: CREATE ROLE níže nemá na schématu závislost a je idempotentní.');
L.push('--');
L.push('-- ⚠️ HESLO ROLE NENÍ V TOMHLE SOUBORU a nikdy tu být nesmí. Z pg_roles');
L.push("--    ho vyčíst nelze. Při deployi vygenerovat, uložit do env a nastavit");
L.push("--    samostatně: ALTER ROLE tixly_app WITH PASSWORD '<z env>';");
L.push('--');
L.push('-- ⚠️ NEGENERUJE SE Z PRODUKČNÍCH ACL. Původní verze vznikla opsáním');
L.push('--    `nspacl`/`relacl` z produkce, a právě proto v ní CHYBĚLA schémata');
L.push('--    `communications` a `brands` — na produkci grant nemají. Aplikace na');
L.push('--    ně pod `tixly_app` padala na 42501 (FINDINGS §26, §33). Generátor');
L.push('--    proto vyjadřuje ZÁMĚR: grant na všechna uživatelská schémata.');
L.push('--');
L.push('-- POZN.: granty na objekty vlastněné extensionou (pg_depend deptype=e,');
L.push('-- typicky PostGIS: geography_columns, geometry_columns, spatial_ref_sys)');
L.push('-- jsou ZÁMĚRNĚ VYNECHANÉ. Vlastní je cloud_admin, neondb_owner na ně');
L.push('-- grant udělit NEMŮŽE a Postgres vrátí WARNING „no privileges were');
L.push('-- granted", NE error — takže to nechytí ani ON_ERROR_STOP=1.');
L.push('--');
L.push('-- Vygenerováno skriptem scripts/gen-baseline-globals.mjs.');
L.push('--');
L.push('');
L.push('-- ── role ─────────────────────────────────────────────────────────────');
L.push('DO $$ BEGIN');
L.push("  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN");
L.push('    CREATE ROLE tixly_app LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE;');
L.push('  END IF;');
L.push('END $$;');
L.push('');
L.push('-- ── členství ─────────────────────────────────────────────────────────');
L.push('GRANT tixly_app TO neondb_owner;');
L.push('');
L.push(`-- ── USAGE na schématech (${schemas.length}) ──────────────────────────`);
for (const s of schemas) L.push(`GRANT USAGE ON SCHEMA "${s}" TO tixly_app;`);
L.push('');
L.push(`-- ── granty per tabulku (${tables.length}) ──────────────────────────`);
for (const t of tables)
  L.push(
    `GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "${t.nspname}"."${t.relname}" TO tixly_app;`,
  );
L.push('');
L.push(`-- ── granty na sekvence (${seqs.length}) ──────────────────────────`);
for (const s of seqs)
  L.push(`GRANT SELECT, UPDATE, USAGE ON SEQUENCE "${s.nspname}"."${s.relname}" TO tixly_app;`);
L.push('');
L.push(`-- ── default privileges (${schemas.length * 3}) ──────────────────────────`);
for (const s of schemas) {
  L.push(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA "${s}" GRANT SELECT, UPDATE, USAGE ON SEQUENCES TO tixly_app;`,
  );
  L.push(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${s}" GRANT EXECUTE ON FUNCTIONS TO tixly_app;`);
  L.push(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA "${s}" GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO tixly_app;`,
  );
}
const sql = L.join('\n') + '\n';

// ── pojistka: granty se nesmí tiše zmenšit ───────────────────────────────────
const prev = readFileSync(TARGET, 'utf8');
const cnt = (s, re) => (s.match(re) || []).length;
// Pozor na `ON TABLES` / `ON SEQUENCES` v ALTER DEFAULT PRIVILEGES — bez
// kotvy a mezery na konci se započítají taky (78 falešných shod na každé).
const before = {
  usage: cnt(prev, /^GRANT USAGE ON SCHEMA /gm),
  table: cnt(prev, /^GRANT .* ON TABLE /gm),
  seq: cnt(prev, /^GRANT .* ON SEQUENCE /gm),
  def: cnt(prev, /^ALTER DEFAULT PRIVILEGES /gm),
};
const after = { usage: schemas.length, table: tables.length, seq: seqs.length, def: schemas.length * 3 };
console.log('           dřív  →  teď');
let regressed = false;
for (const k of Object.keys(before)) {
  const d = after[k] - before[k];
  console.log(`  ${k.padEnd(6)} ${String(before[k]).padStart(4)}  → ${String(after[k]).padStart(4)}  (${d >= 0 ? '+' : ''}${d})`);
  if (after[k] < before[k]) regressed = true;
}
if (regressed) {
  console.error('❌ REGRESE: vygenerováno MÉNĚ položek než v předchozí verzi. Nezapisuji.');
  process.exit(1);
}
for (const s of ['communications', 'brands']) {
  if (!schemas.includes(s)) {
    console.error(`❌ schéma ${s} v generovaném souboru CHYBÍ. Nezapisuji.`);
    process.exit(1);
  }
}
console.log('✅ žádná regrese; communications i brands přítomné');

if (WRITE) {
  writeFileSync(TARGET, sql);
  console.log(`[gen] zapsáno → ${TARGET}`);
} else {
  console.log('[gen] --write nezadán, soubor NEZMĚNĚN');
}
