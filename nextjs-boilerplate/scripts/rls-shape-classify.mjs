#!/usr/bin/env node
/**
 * rls-shape-classify.mjs — roztřídí policies s vnořeným RLS podle KARDINALITY
 * korelace.
 *
 * ── Co se vyvrátilo cestou ───────────────────────────────────────────────────
 * Hypotéza „`EXISTS` s JOINem = drahý" NEPLATÍ: `order_items` join má a stojí
 * 1,4×. Přítomnost JOINu cenu neurčuje.
 *
 * ── Co rozhoduje ─────────────────────────────────────────────────────────────
 * Na CO je poddotaz korelovaný, tedy kolik řádků cílové tabulky připadne na
 * JEDEN kandidátní řádek:
 *   LEVNÝ = korelace na sloupec krytý UNIQUE indexem / PK  → 1 řádek
 *   DRAHÝ = korelace na neunikátní sloupec                 → N řádků
 *
 * Unikátnost se NEHÁDÁ z názvu sloupce, ale čte se z `pg_index.indisunique` —
 * datový dotaz místo parsování řetězce (předchozí regexová verze neprošla
 * self-checkem, viz FINDINGS §55).
 *
 * Korelace = rovnost mezi sloupcem cílové tabulky a VNĚJŠÍM odkazem
 * (`o.id = conversions.order_id`) nebo parametrem funkce (`o.user_id = target`).
 * Porovnání proti `app_current_user_id()` je filtr, ne korelace — nezmenšuje
 * počet řádků připadajících na kandidáta.
 *
 *   NEON_API_KEY=... node scripts/rls-shape-classify.mjs clone.json
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const TARGET = 'orders.orders';
const c = new pg.Client({ connectionString: clone.ownerUri });
await c.connect();

const pol = (await c.query(`
  SELECT schemaname sch, tablename tbl, policyname pol, cmd, qual, with_check
  FROM pg_policies ORDER BY 1,2,3`)).rows;
const fns = (await c.query(`
  SELECT n.nspname||'.'||p.proname fqn, p.proname nm, pg_get_functiondef(p.oid) def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prokind='f'`)).rows;

const uniq = new Set((await c.query(`
  SELECT a.attname col
  FROM pg_index i
  JOIN pg_class cl ON cl.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indisunique AND n.nspname||'.'||cl.relname = $1
    AND array_length(i.indkey::int[],1) = 1`, [TARGET])).rows.map((r) => r.col));
await c.end();
console.log(`unikátní sloupce ${TARGET}: ${[...uniq].join(', ') || '(žádné)'}`);

const fnByName = new Map();
for (const f of fns) { fnByName.set(f.fqn, f); fnByName.set(f.nm, f); }

function inline(expr, depth = 0, seen = new Set()) {
  if (!expr || depth > 3) return expr || '';
  let out = expr;
  for (const m of [...expr.matchAll(/\b([a-z_][a-z_0-9]*\.)?([a-z_][a-z_0-9]*)\s*\(/gi)]) {
    const f = fnByName.get((m[1] ?? '') + m[2]) ?? fnByName.get(m[2]);
    if (!f || seen.has(f.fqn)) continue;
    seen.add(f.fqn);
    out += '\n' + inline(f.def, depth + 1, seen);
  }
  return out;
}

function subqueries(expr) {
  const out = [];
  const re = /(?:EXISTS|IN)\s*\(\s*SELECT/gi;
  let m;
  while ((m = re.exec(expr))) {
    const i = expr.indexOf('(', m.index);
    let d = 0, j = i;
    for (; j < expr.length; j++) {
      if (expr[j] === '(') d++;
      else if (expr[j] === ')') { d--; if (d === 0) break; }
    }
    out.push(expr.slice(i, j + 1));
  }
  return out;
}

/** Aliasy, pod kterými v poddotazu vystupuje cílová tabulka. */
function aliasesOf(body, target) {
  const [sch, tbl] = target.split('.');
  const out = new Set([tbl]);
  const re = new RegExp(sch + '\\.' + tbl + '\\s+(?:AS\\s+)?([a-z_][a-z_0-9]*)', 'gi');
  let m;
  while ((m = re.exec(body))) {
    if (!/^(on|where|join|and|or|group|order|limit)$/i.test(m[1])) out.add(m[1]);
  }
  return [...out];
}

const rows = [];
for (const p of pol) {
  const src = p.sch + '.' + p.tbl;
  if (src === TARGET) continue;
  const expr = inline((p.qual || '') + ' ' + (p.with_check || ''));
  if (!expr.includes(TARGET)) continue;
  const subs = subqueries(expr).filter((b) => b.includes(TARGET));
  if (!subs.length) continue;

  let verdict = 'NEJASNÝ';
  let why = 'v poddotazu nenalezena rovnostní korelace na cílovou tabulku';
  for (const body of subs) {
    const found = [];
    for (const al of aliasesOf(body, TARGET)) {
      const re = new RegExp(al + '\\.([a-z_][a-z_0-9]*)\\s*=\\s*([^\\s)]+)', 'gi');
      let m;
      while ((m = re.exec(body))) {
        const col = m[1];
        const rhs = m[2];
        const outerRef = /^[a-z_][a-z_0-9]*\.[a-z_]/i.test(rhs) && rhs.slice(0, al.length + 1) !== al + '.';
        const isParam = /^target$/i.test(rhs);
        if (outerRef || isParam) found.push(col);
      }
    }
    if (!found.length) continue;
    const corr = [...new Set(found)];
    const hit = corr.filter((x) => uniq.has(x));
    if (hit.length) {
      verdict = 'LEVNÝ';
      why = 'korelace na UNIKÁTNÍ sloupec (' + hit.join(', ') + ') → 1 řádek na kandidáta';
    } else {
      verdict = 'DRAHÝ';
      why = 'korelace jen na NEUNIKÁTNÍ sloupce (' + corr.join(', ') + ') → N řádků na kandidáta';
      break;
    }
  }
  rows.push({ src, pol: p.pol, cmd: p.cmd, verdict, why });
}

const by = (v) => rows.filter((r) => r.verdict === v);
console.log('\n═══ KARDINALITA KORELACE (policies → ' + TARGET + ') ═══');
console.log('celkem ' + rows.length + '   DRAHÝ ' + by('DRAHÝ').length + '   LEVNÝ ' + by('LEVNÝ').length + '   NEJASNÝ ' + by('NEJASNÝ').length);

console.log('\n── SELF-CHECK (podmínka zveřejnění čísla) ──');
let ok = true;
for (const [needle, want, meas] of [['identity.users', 'DRAHÝ', '128x'], ['order_items', 'LEVNÝ', '1,4x']]) {
  const f = rows.filter((r) => r.src.includes(needle));
  if (!f.length) { console.log('   ' + needle + ': NENALEZENO 🔴'); ok = false; continue; }
  for (const r of f) {
    const good = r.verdict === want;
    if (!good) ok = false;
    console.log('   ' + r.src + '.' + r.pol + ' → ' + r.verdict + ' (měřeno ' + meas + ') ' + (good ? '✅' : '🔴 NESEDÍ, čekáno ' + want));
    console.log('       ' + r.why);
  }
}
console.log('\n' + (ok ? '✅ SELF-CHECK PROŠEL — čísla lze zveřejnit' : '🔴 SELF-CHECK NEPROŠEL — čísla NEZVEŘEJŇOVAT'));
if (!ok) process.exit(1);

for (const v of ['DRAHÝ', 'NEJASNÝ']) {
  console.log('\n═══ ' + v + ' (' + by(v).length + ') ═══');
  by(v).forEach((r) => console.log('  ' + r.src + '.' + r.pol + ' [' + r.cmd + '] — ' + r.why));
}
console.log('\n═══ LEVNÝ (' + by('LEVNÝ').length + ') — zdrojové tabulky ═══');
console.log('  ' + [...new Set(by('LEVNÝ').map((r) => r.src))].join(', '));
