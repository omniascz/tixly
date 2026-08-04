#!/usr/bin/env node
/**
 * rls-shape-classify.mjs — roztřídí policies s vnořeným RLS podle TVARU predikátu.
 *
 * 🔴 NEDOKONČENO — VÝSTUPU NEVĚŘIT. Skript dvakrát NEPROŠEL vlastní validací:
 *    1. pravidlo „JOIN uvnitř poddotazu = DRAHÝ" → `order_items` vyšel DRAHÝ,
 *       ale změřený je 1,4× (LEVNÝ)
 *    2. pravidlo „korelace na PK = LEVNÝ" → všech 64 vyšlo NEJASNÝCH, přestože
 *       tytéž regexy nad týmž řetězcem samostatně vracejí true
 *    Rozdíl mezi 128× a 1,4× je pravděpodobně v korelaci na PK vs neunikátní
 *    sloupec, ale DOLOŽENO TO NENÍ. Viz FINDINGS §55.
 *
 * §53 ukázalo, že diskriminátor NENÍ objem cílové tabulky, ale tvar:
 *   DRAHÝ  — `EXISTS` s JOINem přes 2+ tabulky, korelovaný na každý kandidátní
 *            řádek (vzor `identity.users` → orders→events = 128×)
 *   LEVNÝ  — prostý `IN (SELECT … WHERE id = …)` nebo `EXISTS` nad jedním
 *            indexovaným sloupcem (vzor `order_items` = 1,4×)
 *
 * Klasifikace se VALIDUJE proti změřeným případům — když `identity.users`
 * nevyjde DRAHÝ a `order_items` LEVNÝ, je pravidlo špatně, ne data.
 *
 *   NEON_API_KEY=... node scripts/rls-shape-classify.mjs clone.json
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const c = new pg.Client({ connectionString: clone.ownerUri });
await c.connect();

const pol = (await c.query(`
  SELECT schemaname sch, tablename tbl, policyname pol, cmd, qual, with_check
  FROM pg_policies ORDER BY 1,2,3`)).rows;
const fns = (await c.query(`
  SELECT n.nspname||'.'||p.proname fqn, p.proname nm, pg_get_functiondef(p.oid) def, p.prosecdef secdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prokind='f'`)).rows;
await c.end();
const fnByName = new Map();
for (const f of fns) { fnByName.set(f.fqn, f); fnByName.set(f.nm, f); }

/** Rozvine volání app_*() / public.*() do těla, ať klasifikujeme skutečný tvar. */
function inline(expr, depth = 0, seen = new Set()) {
  if (!expr || depth > 3) return expr || '';
  let out = expr;
  for (const m of [...expr.matchAll(/\b([a-z_][a-z_0-9]*\.)?([a-z_][a-z_0-9]*)\s*\(/gi)]) {
    const nm = (m[1] ?? '') + m[2];
    const f = fnByName.get(nm) ?? fnByName.get(m[2]);
    if (!f || seen.has(f.fqn)) continue;
    seen.add(f.fqn);
    out += '\n/*' + f.nm + '*/ ' + inline(f.def, depth + 1, seen);
  }
  return out;
}

/** Vytáhne jednotlivé poddotazy (EXISTS / IN) i s obsahem. */
function subqueries(expr) {
  const out = [];
  const re = /(EXISTS|IN)\s*\(\s*SELECT/gi;
  let m;
  while ((m = re.exec(expr))) {
    let i = expr.indexOf('(', m.index + m[0].indexOf('(') - 1), d = 0, j = i;
    for (; j < expr.length; j++) {
      if (expr[j] === '(') d++;
      else if (expr[j] === ')') { d--; if (d === 0) break; }
    }
    out.push({ kind: m[1].toUpperCase(), body: expr.slice(i, j + 1) });
  }
  return out;
}

const TARGET = 'orders.orders';
const rows = [];
for (const p of pol) {
  const raw = `${p.qual || ''} ${p.with_check || ''}`;
  const expr = inline(raw);
  if (!expr.includes(TARGET)) continue;
  const src = `${p.sch}.${p.tbl}`;
  if (src === TARGET) continue;
  const subs = subqueries(expr).filter((s) => s.body.includes(TARGET));
  if (!subs.length) continue;
  // ── DISKRIMINÁTOR: na CO je poddotaz korelovaný ────────────────────────
  // Validace proti měření vyvrátila první pravidlo („JOIN uvnitř = DRAHÝ"):
  // `order_items` má JOIN a přesto stojí 1,4×. Rozhoduje něco jiného —
  // jestli se poddotaz korelovaným sloupcem trefí do PRIMÁRNÍHO KLÍČE cílové
  // tabulky (1 řádek na kandidáta), nebo do NEUNIKÁTNÍHO sloupce (N řádků).
  //   LEVNÝ : `o.id = X.order_id`         → PK lookup, join nad 1 řádkem
  //   DRAHÝ : `o.user_id = app_current_user_id()` → sken po neunikátním sloupci
  let verdict = 'NEJASNÝ', why = 'korelace nerozpoznána', worst = subs[0];
  for (const s of subs) {
    const b = s.body;
    // korelace na PK cílové tabulky: <alias>.id = <cokoli>
    const pkCorr = /([a-z_]+[a-z_0-9]*)\.id\s*=\s*[a-z_]/i.test(b);
    // korelace na neunikátní sloupec orders (user_id / promoter_id / event_id)
    const nonPk = /orders[\s\S]{0,120}?\.(user_id|event_id|promoter_id)\s*=/i.test(b)
                  || /[a-z_]+\.(user_id)\s*=\s*(app_current_user_id|target)/i.test(b);
    if (pkCorr && !nonPk) { verdict = 'LEVNÝ'; why = 'korelace na PRIMÁRNÍ KLÍČ (1 řádek na kandidáta)'; worst = s; break; }
    if (nonPk) { verdict = 'DRAHÝ'; why = 'korelace na NEUNIKÁTNÍ sloupec → N řádků na kandidáta'; worst = s; break; }
  }
  rows.push({ src, pol: p.pol, cmd: p.cmd, verdict, why, snippet: worst.body.replace(/\s+/g, ' ').slice(0, 150) });
}

const by = (v) => rows.filter((r) => r.verdict === v);
console.log('═══ TVAR PREDIKÁTU (policies sahající na orders.orders) ═══');
console.log(`celkem: ${rows.length}   DRAHÝ: ${by('DRAHÝ').length}   LEVNÝ: ${by('LEVNÝ').length}   NEJASNÝ: ${by('NEJASNÝ').length}`);

console.log('\n── VALIDACE proti změřeným ──');
const chk = (srcMatch, want) => {
  const f = rows.filter((r) => r.src.includes(srcMatch));
  if (!f.length) { console.log(`   ${srcMatch}: NENALEZENO (nelze validovat)`); return; }
  f.forEach((r) => console.log(`   ${r.src}.${r.pol} → ${r.verdict} ${r.verdict === want ? '✅ sedí' : '🔴 NESEDÍ (čekáno ' + want + ')'}`));
};
chk('identity.users', 'DRAHÝ');
chk('order_items', 'LEVNÝ');

for (const v of ['DRAHÝ', 'NEJASNÝ', 'LEVNÝ']) {
  console.log(`\n═══ ${v} (${by(v).length}) ═══`);
  by(v).forEach((r) => {
    console.log(`  ${r.src}.${r.pol} [${r.cmd}]  — ${r.why}`);
    if (v !== 'LEVNÝ') console.log(`      ${r.snippet}`);
  });
}
