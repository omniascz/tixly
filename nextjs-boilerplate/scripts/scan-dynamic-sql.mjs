#!/usr/bin/env node
/**
 * scan-dynamic-sql.mjs — dotazy skladane ZA BEHU. Guard ani statické skeny je nevidi.
 *
 * Zajimaji nas dve veci:
 *   1) kde se SQL sklada interpolaci `${…}` nebo konkatenaci
 *   2) jestli do te interpolace tece UZIVATELSKY VSTUP (pak je to injection)
 *
 * ⚠️ Nula z tohohle nastroje nic neznamena bez self-checku (§54, §128).
 *
 *   node scripts/scan-dynamic-sql.mjs [--selfcheck]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);

const SQL_KW = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|FROM|JOIN|WHERE|ORDER\s+BY|SET)\b/i;

/** Zdroje, ktere pochazi od uzivatele. */
const USER_SRC = [
  /\bsearchParams\b/, /\bnextUrl\.searchParams\b/, /\breq\.query\b/,
  /\bparams\.[a-zA-Z]/, /\bawait\s+req\.json\(\)/, /\bbody\.[a-zA-Z]/,
  /\binput\.[a-zA-Z]/, /\bparsed\.data\b/, /\bsp\.get\(/,
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) { if (!/node_modules|\.next|dist/.test(p)) walk(p, out); }
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const lineOf = (s, i) => s.slice(0, i).split('\n').length;

/** Vytahne template literaly, ktere vypadaji jako SQL a nesou `${…}`. */
function dynamicQueries(src) {
  const hits = [];
  const re = /`([^`\\]|\\.)*`/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const lit = m[0];
    if (!SQL_KW.test(lit)) continue;
    const interps = [...lit.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1].trim());
    if (!interps.length) continue;
    hits.push({ line: lineOf(src, m.index), interps, lit });
  }
  // konkatenace: `'… WHERE …' + neco`
  const cat = /(['"])[^'"]*\b(?:WHERE|ORDER BY|AND|SET)\b[^'"]*\1\s*\+/gi;
  while ((m = cat.exec(src)) !== null) {
    hits.push({ line: lineOf(src, m.index), interps: ['(konkatenace)'], lit: m[0] });
  }
  return hits;
}

/** Je promenna v interpolaci odvozena od uzivatelskeho vstupu? */
function looksUserDerived(name, src) {
  if (/^\$\{?\d/.test(name)) return false;
  const bare = name.replace(/[^A-Za-z0-9_.]/g, ' ').split(/\s+/).filter(Boolean);
  for (const tok of bare) {
    if (/^(i|idx|n|len|limit|offset)$/.test(tok)) continue;
    // primy uzivatelsky zdroj v samotne interpolaci
    if (USER_SRC.some((r) => r.test(tok))) return true;
    // promenna prirazena z uzivatelskeho zdroje kdekoli v souboru
    const assign = new RegExp(`\\b(?:const|let|var)\\s+${tok.split('.')[0]}\\s*=([^;]{0,200});`);
    const a = assign.exec(src);
    if (a && USER_SRC.some((r) => r.test(a[1]))) return true;
  }
  return false;
}

if (flag('selfcheck')) {
  // Fixtura: znamy bezpecny vzor (cislovane placeholdery) vs znamy rizikovy
  const safe = 'const q = `SELECT * FROM t WHERE id = $${i} AND x = $${i + 1}`;';
  const risky = 'const col = sp.get("sort"); const q = `SELECT * FROM t ORDER BY ${col}`;';
  const s1 = dynamicQueries(safe);
  const s2 = dynamicQueries(risky);
  const r2 = s2.length > 0 && s2[0].interps.some((v) => looksUserDerived(v, risky));
  const r1 = s1.length > 0 && s1[0].interps.some((v) => looksUserDerived(v, safe));
  console.log(`[selfcheck] dynamicky dotaz v bezpecne fixture nalezen : ${s1.length > 0}`);
  console.log(`[selfcheck]   … oznacen jako uzivatelsky               : ${r1}  (ma byt false)`);
  console.log(`[selfcheck] dynamicky dotaz v rizikove fixture nalezen : ${s2.length > 0}`);
  console.log(`[selfcheck]   … oznacen jako uzivatelsky               : ${r2}  (ma byt true)`);
  const ok = s1.length > 0 && !r1 && s2.length > 0 && r2;
  console.log(ok ? '[selfcheck] PROSEL — skener rozlisi bezpecny a rizikovy vzor'
                 : '[selfcheck] SELHAL — vysledky NEHLASIT');
  process.exit(ok ? 0 : 1);
}

const files = walk('src');
let totalDyn = 0;
const userDerived = [];
const internalOnly = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const h of dynamicQueries(src)) {
    totalDyn++;
    const rel = f.replace(/\\/g, '/').replace('src/app/api/', '').replace('src/', '');
    const user = h.interps.filter((v) => looksUserDerived(v, src));
    if (user.length) userDerived.push({ f: rel, line: h.line, vars: [...new Set(user)] });
    else internalOnly.push({ f: rel, line: h.line });
  }
}
console.log(`dynamickych dotazu celkem        : ${totalDyn}`);
console.log(`  z UZIVATELSKEHO vstupu         : ${userDerived.length}`);
console.log(`  jen z internich konstant       : ${internalOnly.length}`);
console.log();
for (const u of userDerived) console.log(`  ${u.f}:${u.line}  ${u.vars.join(', ').slice(0, 60)}`);
