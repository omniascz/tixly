#!/usr/bin/env node
/**
 * audit-auto-columns.mjs — kdo zapisuje "automaticke" sloupce do tabulek,
 * ktere je NEMAJI.
 *
 * Proc: `updated_at = NOW()` je zkopirovany idiom. Objevil se uz dvakrat
 * nezavisle (party-split vrstva 8, publish/events:135) nad `catalog.ticket_types`,
 * ktera sloupec nema — 42703. Tataz trida jako `base64url` ve trech migracich:
 * jeden vzor rozkopirovany na mista, kde neplati.
 *
 * Zdroj pravdy je baseline (schema), ne klon — nepotrebuje DB.
 *
 *   node scripts/audit-auto-columns.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASELINE = new URL('../../migrations/000_baseline_20260730.sql', import.meta.url)
  .pathname.replace(/^\/([A-Z]:)/, '$1');
const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const AUTO = ['updated_at', 'created_at'];

// ── 1) z baseline: tabulka -> mnozina sloupcu ───────────────────────────────
const sql = readFileSync(BASELINE, 'utf8');
const tables = new Map();
for (const m of sql.matchAll(/^CREATE TABLE ([a-z_]+\.[a-z_]+) \(([\s\S]*?)^\);/gm)) {
  const cols = new Set();
  for (const line of m[2].split('\n')) {
    const c = line.match(/^\s{4}([a-z_][a-z_0-9]*) /);
    if (c) cols.add(c[1]);
  }
  tables.set(m[1], cols);
}
console.log(`[audit] tabulek v baseline: ${tables.size}`);
for (const col of AUTO) {
  const without = [...tables].filter(([, c]) => !c.has(col)).length;
  console.log(`  bez ${col}: ${without} / ${tables.size}`);
}

// ── 2) projit zdrojaky ──────────────────────────────────────────────────────
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
})(SRC);

/** Najde tabulku, ke ktere se vztahuje UPDATE/INSERT zacinajici pred pozici i. */
function tableFor(text, i, kind) {
  const head = text.slice(Math.max(0, i - 600), i);
  const re = kind === 'UPDATE' ? /UPDATE\s+([a-z_]+\.[a-z_]+)/gi : /INSERT\s+INTO\s+([a-z_]+\.[a-z_]+)/gi;
  let last = null, m;
  while ((m = re.exec(head))) last = m[1];
  return last;
}

const hits = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const col of AUTO) {
    // a) UPDATE ... SET ... updated_at
    for (const m of text.matchAll(new RegExp(`\\b${col}\\s*=\\s*(NOW\\(\\)|now\\(\\)|\\$\\d+)`, 'g'))) {
      const t = tableFor(text, m.index, 'UPDATE') ?? tableFor(text, m.index, 'INSERT');
      if (t && tables.has(t) && !tables.get(t).has(col)) {
        hits.push({ f, col, table: t, line: text.slice(0, m.index).split('\n').length, how: 'SET' });
      }
    }
    // b) seznam sloupcu v INSERT (par. 71 — sloupec a hodnota nesousedi)
    for (const m of text.matchAll(new RegExp(`\\(([^)]*\\b${col}\\b[^)]*)\\)\\s*\\n?\\s*VALUES`, 'g'))) {
      const t = tableFor(text, m.index, 'INSERT');
      if (t && tables.has(t) && !tables.get(t).has(col)) {
        hits.push({ f, col, table: t, line: text.slice(0, m.index).split('\n').length, how: 'INSERT-cols' });
      }
    }
  }
}

const uniq = [...new Map(hits.map((h) => [`${h.f}|${h.line}|${h.col}`, h])).values()];
console.log(`\n═══ ZAPIS DO NEEXISTUJICIHO SLOUPCE: ${uniq.length} ═══`);
for (const h of uniq.sort((a, b) => a.table.localeCompare(b.table))) {
  console.log(`  ${h.table.padEnd(30)} ${h.col.padEnd(11)} ${h.how.padEnd(12)} ${h.f.replace(SRC, 'src')}:${h.line}`);
}
if (!uniq.length) console.log('  (zadny)');
