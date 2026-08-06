#!/usr/bin/env node
/**
 * scan-silent-writes.mjs — hleda tridu "zapis, ktery se nikdy nestal"
 * (FINDINGS §127). Predloha je seat-upgrade-notify pred opravou:
 *
 *   await client.query(
 *     `INSERT ... VALUES ($1, NOW(), 'notified') ...`,
 *   ).catch(() => { });
 *   notified++;
 *
 * Tri samostatne vady:
 *   A) dotaz ma $n, ale POLE PARAMETRU se nepredava  -> Postgres odmitne vzdy
 *   B) chyba zapisu spolknuta catchem bez zaznamu
 *   C) citac inkrementovany bez vazby na vysledek
 *
 * ⚠️ Nula z tohohle nastroje NIC NEZNAMENA bez self-checku (§54, §128).
 * Predchozi pokus psany do `node -e` byl SLEPY kvuli escapovani `$` v shellu —
 * proto je tenhle ve SOUBORU a ma povinny `--selfcheck`.
 *
 *   node scripts/scan-silent-writes.mjs --selfcheck --fixture=<soubor>
 *   node scripts/scan-silent-writes.mjs --root=src
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const h = argv.find((a) => a.startsWith(`--${n}=`));
  return h ? h.slice(n.length + 3) : d;
};
const flag = (n) => argv.includes(`--${n}`);

/** Vrati index znaku za uzavirajici zavorkou k otevirajici na `open`. */
function matchParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '`') { // preskoc template literal vcetne ${}
      let d = 0;
      for (i++; i < s.length; i++) {
        if (s[i] === '\\') { i++; continue; }
        if (s[i] === '`' && d === 0) break;
        if (s[i] === '$' && s[i + 1] === '{') { d++; i++; continue; }
        if (s[i] === '}' && d > 0) d--;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      for (i++; i < s.length; i++) { if (s[i] === '\\') { i++; continue; } if (s[i] === c) break; }
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const lineOf = (s, idx) => s.slice(0, idx).split('\n').length;

function scanFile(path) {
  const s = readFileSync(path, 'utf8');
  const hits = [];

  // ── A) dotaz s $n bez pole parametru ─────────────────────────────────────
  const qre = /\.query\s*(?:<[^>]*>)?\s*\(/g;
  let m;
  while ((m = qre.exec(s)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(s, open);
    if (close === -1) continue;
    const args = s.slice(open + 1, close);
    // ma placeholder mimo ${} interpolaci?
    const hasPlaceholder = /\$\d/.test(args.replace(/\$\{[^}]*\}/g, ''));
    if (!hasPlaceholder) continue;
    // druhy argument = carka na urovni 0 mimo retezce
    let depth = 0, second = false;
    for (let i = 0; i < args.length; i++) {
      const c = args[i];
      if (c === '`' || c === "'" || c === '"') {
        const q = c;
        for (i++; i < args.length; i++) {
          if (args[i] === '\\') { i++; continue; }
          if (q === '`' && args[i] === '$' && args[i + 1] === '{') { let d = 1; i += 2; while (i < args.length && d > 0) { if (args[i] === '{') d++; if (args[i] === '}') d--; i++; } i--; continue; }
          if (args[i] === q) break;
        }
        continue;
      }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === ',' && depth === 0 && args.slice(i + 1).trim() !== '') second = true;
    }
    if (!second) hits.push({ kind: 'A_DOTAZ_BEZ_PARAMETRU', line: lineOf(s, open) });
  }

  // ── B) catch polykajici chybu (prazdny nebo jen komentar) ────────────────
  const cre = /\.catch\s*\(\s*\((?:[^)]*)\)\s*=>\s*\{([\s\S]{0,200}?)\}\s*\)/g;
  while ((m = cre.exec(s)) !== null) {
    const body = m[1].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (body === '') hits.push({ kind: 'B_CATCH_POLYKAC', line: lineOf(s, m.index) });
  }
  const cre2 = /\bcatch\s*(?:\([^)]*\))?\s*\{([\s\S]{0,200}?)\}/g;
  while ((m = cre2.exec(s)) !== null) {
    const body = m[1].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (body === '') hits.push({ kind: 'B_CATCH_POLYKAC', line: lineOf(s, m.index) });
  }

  // ── C) citac hned za polykacem (heuristika) ──────────────────────────────
  const lines = s.split('\n');
  for (const h of hits.filter((x) => x.kind === 'B_CATCH_POLYKAC')) {
    for (let i = h.line; i < Math.min(h.line + 6, lines.length); i++) {
      if (/^\s*\w+\+\+\s*;/.test(lines[i])) {
        hits.push({ kind: 'C_CITAC_BEZ_VAZBY', line: i + 1 });
        break;
      }
    }
  }
  return hits;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) { if (!/node_modules|\.next|dist/.test(p)) walk(p, out); }
    else if (/\.ts$/.test(e)) out.push(p);
  }
  return out;
}

// ── SELF-CHECK ───────────────────────────────────────────────────────────────
if (flag('selfcheck')) {
  const fx = opt('fixture');
  if (!fx) { console.error('chybi --fixture='); process.exit(2); }
  const hits = scanFile(fx);
  const a = hits.filter((h) => h.kind === 'A_DOTAZ_BEZ_PARAMETRU');
  const b = hits.filter((h) => h.kind === 'B_CATCH_POLYKAC');
  const c = hits.filter((h) => h.kind === 'C_CITAC_BEZ_VAZBY');
  console.log(`[selfcheck] fixture: ${fx}`);
  console.log(`  A dotaz bez parametru : ${a.length} ${a.map((x) => x.line).join(',')}`);
  console.log(`  B catch polykac       : ${b.length} ${b.map((x) => x.line).join(',')}`);
  console.log(`  C citac bez vazby     : ${c.length} ${c.map((x) => x.line).join(',')}`);
  const ok = a.length > 0 && b.length > 0;
  console.log(ok ? '[selfcheck] PROSEL — skener zname vady NAJDE'
                 : '[selfcheck] SELHAL — skener je SLEPY, vysledky NEHLASIT');
  process.exit(ok ? 0 : 1);
}

const root = opt('root', 'src');
const byKind = { A_DOTAZ_BEZ_PARAMETRU: [], B_CATCH_POLYKAC: [], C_CITAC_BEZ_VAZBY: [] };
for (const f of walk(root)) {
  for (const h of scanFile(f)) byKind[h.kind].push(`${f.replace(/\\/g, '/')}:${h.line}`);
}
for (const [k, list] of Object.entries(byKind)) {
  console.log(`\n=== ${k} — ${list.length} ===`);
  list.slice(0, 40).forEach((x) => console.log('  ' + x));
  if (list.length > 40) console.log(`  … a dalsich ${list.length - 40}`);
}
