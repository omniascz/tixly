#!/usr/bin/env node
/**
 * scan-report-columns.mjs — overi, ze SLOUPCE pouzite v reportech existuji.
 *
 * `DISABLED_REPORTS` vzniklo ze skenu chybejicich TABULEK (§154), takze reporty
 * se spatnym SLOUPCEM jim proklouzly — `udalosti_resell` pouzival
 * `re.price_halire`, zatimco tabulka ma `listing_price_halire` (§168, R-44).
 *
 * ⚠️ Nula z tohohle nastroje nic neznamena bez self-checku (§54, §128).
 * `--selfcheck --fixture=<soubor>` musi najit ZNAME pripady, jinak exit 1.
 *
 * MEZ NASTROJE: zvlada jen KVALIFIKOVANE odkazy `alias.sloupec`. Nekvalifikovane
 * (`SELECT status FROM …`) se nedaji priradit k tabulce bez parseru SQL —
 * vypisuji se zvlast jako NEPOKRYTE, aby bylo videt, co cislo netvrdi.
 *
 *   node scripts/scan-report-columns.mjs [--selfcheck --fixture=<soubor>]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const h = argv.find((a) => a.startsWith(`--${n}=`));
  return h ? h.slice(n.length + 3) : d;
};
const flag = (n) => argv.includes(`--${n}`);

const BASELINE = opt('baseline', '../migrations/000_baseline_20260730.sql');

function baselineColumns(path) {
  const s = readFileSync(path, 'utf8');
  const out = new Map();
  const re = /CREATE (?:TABLE|VIEW|MATERIALIZED VIEW)(?: IF NOT EXISTS)? ([a-z_]+\.[a-z_]+) \(([\s\S]*?)\n\);/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const cols = new Set();
    for (const c of m[2].matchAll(/^\s{4}([a-z_]+) /gm)) cols.add(c[1]);
    out.set(m[1].toLowerCase(), cols);
  }
  return out;
}

/** SQL klicova slova a funkce, ktere se za `alias.` objevit nemuzou. */
const NOISE = new Set(['count', 'sum', 'min', 'max', 'avg', 'coalesce', 'round']);

function scanSource(src, columns) {
  const findings = [];
  let uncovered = 0;
  // rozsekej po definicich podle `id: '...'`
  const ids = [...src.matchAll(/id: '([a-z0-9_]+)'/g)].map((m) => [m.index, m[1]]);
  for (let i = 0; i < ids.length; i++) {
    const [pos, rid] = ids[i];
    const body = src.slice(pos, i + 1 < ids.length ? ids[i + 1][0] : src.length);
    // alias -> tabulka
    const alias = new Map();
    for (const m of body.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+\.[a-z_]+)\s+(?:AS\s+)?([a-z][a-z0-9_]{0,4})\b/gi)) {
      const a = m[2].toLowerCase();
      if (['on', 'as', 'where', 'left', 'join', 'group', 'order', 'using'].includes(a)) continue;
      alias.set(a, m[1].toLowerCase());
    }
    // nekvalifikovane sloupce v SELECT — jen spocitat, priradit je nejde
    for (const m of body.matchAll(/\bSELECT\s+([a-z_]+)\s*(?:,|\s+AS\b)/gi)) { void m; uncovered++; }
    const bad = [];
    for (const [a, tbl] of alias) {
      const have = columns.get(tbl);
      if (!have) continue; // chybejici tabulku resi jiny sken
      const re = new RegExp('\\b' + a + '\\.([a-z_]+)\\b', 'g');
      let cm;
      while ((cm = re.exec(body)) !== null) {
        const col = cm[1];
        if (NOISE.has(col) || have.has(col)) continue;
        bad.push(`${tbl}.${col}`);
      }
    }
    if (bad.length) findings.push({ id: rid, bad: [...new Set(bad)] });
  }
  return { findings, uncovered };
}

const columns = baselineColumns(BASELINE);

if (flag('selfcheck')) {
  const fx = opt('fixture');
  if (!fx) { console.error('chybi --fixture='); process.exit(2); }
  const { findings } = scanSource(readFileSync(fx, 'utf8'), columns);
  const flat = findings.flatMap((f) => f.bad);
  const want = ['orders.resale_listings.price_halire', 'orders.lottery_entries.user_id'];
  console.log(`[selfcheck] fixture: ${fx}`);
  want.forEach((w) => console.log(`  ${flat.includes(w) ? 'NASEL' : 'NENASEL'}  ${w}`));
  const ok = want.every((w) => flat.includes(w));
  console.log(ok ? '[selfcheck] PROSEL — skener zname pripady najde'
                 : '[selfcheck] SELHAL — skener je SLEPY, vysledky NEHLASIT');
  process.exit(ok ? 0 : 1);
}

const dir = 'src/lib/reports';
let total = 0, uncoveredAll = 0;
const all = [];
for (const fn of readdirSync(dir).filter((f) => f.startsWith('reports-'))) {
  const src = readFileSync(join(dir, fn), 'utf8');
  total += [...src.matchAll(/id: '([a-z0-9_]+)'/g)].length;
  const { findings, uncovered } = scanSource(src, columns);
  uncoveredAll += uncovered;
  findings.forEach((f) => all.push({ ...f, file: fn }));
}
const disabled = new Set(
  [...readFileSync('src/lib/reports/registry.ts', 'utf8').matchAll(/^\s*\['([a-z0-9_]+)',/gm)].map((m) => m[1]),
);
const active = all.filter((f) => !disabled.has(f.id));
console.log(`definic celkem                 : ${total}`);
console.log(`se spatnym SLOUPCEM            : ${all.length}`);
console.log(`  z toho uz vyrazenych         : ${all.length - active.length}`);
console.log(`  AKTIVNICH a pritom rozbitych : ${active.length}`);
console.log();
for (const f of active) console.log(`  ${f.id.padEnd(32)} ${f.file.padEnd(22)} ${f.bad.join(', ').slice(0, 60)}`);
console.log(`\nnekvalifikovanych sloupcu (NEPOKRYTO tímto skenem): ${uncoveredAll}`);
