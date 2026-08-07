#!/usr/bin/env node
/**
 * scan-missing-tables.mjs — najde odkazy na tabulky, ktere ve schematu NEJSOU.
 *
 * Ctvrty nalez teze tridy prisel nahodou (foyer_order_items §130,
 * seat_assignments §126, demand_forecasts §141, seat_maps §153). Tohle je
 * ma najit vsechny najednou.
 *
 * ⚠️ Nula z tohohle nastroje NIC NEZNAMENA bez self-checku (§54, §128).
 * Proto `--selfcheck`, ktery musi najit ZNAME pripady; kdyz je nenajde,
 * skript skonci nenulovym kodem a vysledky se nehlasi.
 *
 *   node scripts/scan-missing-tables.mjs --selfcheck [--extra=<soubor>]
 *   node scripts/scan-missing-tables.mjs --root=src --baseline=../migrations/000_baseline_20260730.sql
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const h = argv.find((a) => a.startsWith(`--${n}=`));
  return h ? h.slice(n.length + 3) : d;
};
const flag = (n) => argv.includes(`--${n}`);

/** Tabulky, ktere baseline opravdu vytvari (vc. pohledu a matview). */
function baselineTables(path) {
  const s = readFileSync(path, 'utf8');
  const t = new Set();
  for (const m of s.matchAll(/CREATE (?:TABLE|VIEW|MATERIALIZED VIEW)(?: IF NOT EXISTS)? ([a-z_]+\.[a-z_]+)/gi)) {
    t.add(m[1].toLowerCase());
    if (m[1].toLowerCase().startsWith('public.')) t.add(m[1].toLowerCase().slice(7));
  }
  return t;
}

/** Odkazy na tabulky v SQL uvnitr TS. Schema.tabulka, tedy zadne aliasy. */
/** b) Tabulky psane BEZ schematu: search_path je `pg_catalog, public`, takze
 *  hole jmeno miri do `public` — nebo nikam. Zachytavame je take. */
const BARE = [
  /FROM\s+([a-z_]{3,})\s/gi,
  /JOIN\s+([a-z_]{3,})\s/gi,
  /INSERT\s+INTO\s+([a-z_]{3,})\s/gi,
];

const REFS = [
  /\bFROM\s+([a-z_]+\.[a-z_]+)/gi,
  /\bJOIN\s+([a-z_]+\.[a-z_]+)/gi,
  /\bINSERT\s+INTO\s+([a-z_]+\.[a-z_]+)/gi,
  /\bUPDATE\s+([a-z_]+\.[a-z_]+)/gi,
  /\bDELETE\s+FROM\s+([a-z_]+\.[a-z_]+)/gi,
];

/**
 * Schemata se ctou Z BASELINE, ne z ruky.
 *
 * Predchozi verze mela zadrateny vycet, ve kterem CHYBELO `public` — a tim
 * propadlo ~12 odkazu (`public.scan_logs`, `public.resale_listings`, ...).
 * Cislo 34 bylo podhodnocene (R-36). Je to POSESTE tataz trida (§82):
 * nastroj si drzi kopii neceho, co se da zjistit z reality.
 */
function baselineSchemas(path) {
  const s = readFileSync(path, 'utf8');
  const out = new Set(['public']);  // public existuje vzdy, i kdyz ho baseline nevytvari
  for (const m of s.matchAll(/CREATE (?:TABLE|VIEW|MATERIALIZED VIEW)(?: IF NOT EXISTS)? ([a-z_]+)\./gi)) {
    out.add(m[1].toLowerCase());
  }
  for (const m of s.matchAll(/CREATE SCHEMA(?: IF NOT EXISTS)? ([a-z_]+)/gi)) out.add(m[1].toLowerCase());
  return out;
}

const lineOf = (s, i) => s.slice(0, i).split('\n').length;

function scanFile(path, known) {
  const s = readFileSync(path, 'utf8');
  const hits = [];
  for (const re of REFS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      const tbl = m[1].toLowerCase();
      const schema = tbl.split('.')[0];
      if (!SCHEMAS.has(schema)) continue;
      if (known.has(tbl)) continue;
      hits.push({ tbl, line: lineOf(s, m.index) });
    }
  }

  // b) Hola jmena bez schematu. `search_path` je `pg_catalog, public`, takze
  //    mirí do `public` — nebo nikam. CTE aliasy a SQL klicova slova se musi
  //    odfiltrovat, jinak by kazdy `FROM cte_x` vypadal jako chybejici tabulka.
  const cte = new Set([...s.matchAll(/(?:WITH|,)\s+([a-z_][a-z0-9_]{2,})\s+AS\s*\(/gi)].map((x) => x[1].toLowerCase()));
  const NOISE = new Set(['select', 'lateral', 'unnest', 'generate_series', 'json_to_recordset',
    'jsonb_to_recordset', 'values', 'only', 'dual', 'each', 'string_to_table', 'regexp_split_to_table']);
  for (const re of BARE) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      const raw = m[1].toLowerCase();
      if (cte.has(raw) || NOISE.has(raw)) continue;
      if (known.has(raw) || known.has(`public.${raw}`)) continue;
      hits.push({ tbl: `(bez schematu) ${raw}`, line: lineOf(s, m.index) });
    }
  }
  return hits;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) { if (!/node_modules|\.next|dist/.test(p)) walk(p, out); }
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/** Kolik dotazu se sklada DYNAMICKY — sken je nevidi. */
function dynamicCount(files) {
  let n = 0;
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    // template literal s ${...} uvnitr SQL klicoveho slova
    for (const m of s.matchAll(/`[^`]*\b(?:FROM|JOIN|INSERT INTO|UPDATE|DELETE FROM)\s+\$\{[^`]*`/gi)) { void m; n++; }
  }
  return n;
}

const baseline = opt('baseline', '../migrations/000_baseline_20260730.sql');
const known = baselineTables(baseline);
const SCHEMAS = baselineSchemas(baseline);

// ── SELF-CHECK ───────────────────────────────────────────────────────────────
if (flag('selfcheck')) {
  const extra = opt('extra');
  const targets = ['catalog.seat_maps', 'public.scan_logs', 'public.resale_listings'];
  const found = new Set();
  const files = walk(opt('root', 'src'));
  for (const f of files) for (const h of scanFile(f, known)) found.add(h.tbl);
  if (extra) for (const h of scanFile(extra, known)) found.add(h.tbl);
  console.log(`[selfcheck] baseline zna ${known.size} tabulek`);
  const want = extra ? [...targets, 'orders.foyer_order_items'] : targets;
  want.forEach((t) => console.log(`  ${found.has(t) ? 'NASEL' : 'NENASEL'}  ${t}`));
  const ok = want.every((t) => found.has(t));
  console.log(ok ? '[selfcheck] PROSEL — skener zname pripady najde'
                 : '[selfcheck] SELHAL — skener je SLEPY, vysledky NEHLASIT');
  process.exit(ok ? 0 : 1);
}

const files = walk(opt('root', 'src'));
const byTable = new Map();
for (const f of files) {
  for (const h of scanFile(f, known)) {
    const key = h.tbl;
    if (!byTable.has(key)) byTable.set(key, []);
    byTable.get(key).push(`${f.replace(/\\/g, '/')}:${h.line}`);
  }
}
const sorted = [...byTable.entries()].sort((a, b) => b[1].length - a[1].length);
console.log(`baseline zna tabulek        : ${known.size}`);
console.log(`NEEXISTUJICI tabulky v kodu : ${sorted.length}`);
for (const [tbl, locs] of sorted) {
  const uniq = [...new Set(locs.map((l) => l.split(':')[0]))];
  console.log(`  ${tbl.padEnd(38)} ${locs.length}x ve ${uniq.length} souborech`);
  uniq.slice(0, 3).forEach((u) => console.log(`      ${u.replace('src/app/api/', '')}`));
}
console.log(`\ndynamicky skladanych dotazu (sken je NEVIDI): ${dynamicCount(files)}`);
