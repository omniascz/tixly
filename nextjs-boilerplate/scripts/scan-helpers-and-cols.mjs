#!/usr/bin/env node
/**
 * scan-helpers-and-cols.mjs — dve veci naraz, at staci jedna vetev:
 *
 * 1) TELA HELPERU `app_*()`. Verdikt „0 z 39 se neotaci" (§198) plati jen
 *    tehdy, kdyz si helper sam nedosazuje default za nenastaveny GUC.
 *    Necte se jen definice — kazdy bezparametricky helper se ZAVOLA
 *    s prazdnym kontextem a vypise se navratova hodnota.
 *
 * 2) ROZTRIDENI sloupcu z R-19 podle toho, S CIM se v policy porovnavaji.
 *    Rizikove jsou ty proti GUC identity; porovnani s jinym sloupcem nebo
 *    konstantou je jina trida.
 *
 *   node scripts/scan-helpers-and-cols.mjs <uri>
 */
import pg from 'pg';

const URI = process.argv[2];
if (!URI) { console.error('pouziti: <uri>'); process.exit(2); }
const pool = new pg.Pool({ connectionString: URI, max: 3 });
const line = (s) => console.log(s);
const hdr = (s) => console.log(`\n${'═'.repeat(70)}\n${s}\n${'═'.repeat(70)}`);

// ════════════════════════════════════════════════════════════════════════════
hdr('1) HELPERY app_*() — co vrati pri PRAZDNEM kontextu');

const fns = await pool.query(`
  SELECT p.proname AS jmeno, pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_functiondef(p.oid) AS def, p.prosecdef AS definer
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname LIKE 'app\\_%' AND n.nspname = 'public'
  ORDER BY p.proname`);

/** Podezrele tvary v tele: default misto NULL, chybejici missing_ok, boolean nad ''. */
function podezreleTvary(def) {
  const n = [];
  if (/COALESCE\s*\(\s*current_setting[^)]*\)\s*,\s*'?(true|t|1|[^']*[^')\s])'?\s*\)/i.test(def)) n.push('COALESCE s defaultem');
  if (/current_setting\s*\(\s*[^,)]+\)/.test(def) && !/current_setting\s*\(\s*[^,)]+,\s*true\s*\)/.test(def)) n.push('current_setting BEZ missing_ok');
  if (/IS\s+NOT\s+NULL/i.test(def)) n.push('IS NOT NULL');
  if (/<>|!=/.test(def)) n.push('<> / !=');
  if (/\bNOT\b/i.test(def)) n.push('NOT');
  return n;
}

const c = await pool.connect();
let helperPovoluje = 0;
try {
  // PRAZDNY kontext: transakce bez jakehokoli SET LOCAL
  await c.query('BEGIN');
  for (const f of fns.rows) {
    const tvary = podezreleTvary(f.def);
    let vysledek;
    if (f.args === '') {
      try {
        const r = await c.query(`SELECT public.${f.jmeno}() AS v`);
        vysledek = JSON.stringify(r.rows[0].v);
      } catch (e) { vysledek = `CHYBA ${e.code}: ${String(e.message).slice(0, 50)}`; }
    } else {
      vysledek = `(ma argumenty: ${f.args}) — nevolano`;
    }
    // „Povoluje" = vrati true, nebo neprazdnou hodnotu tam, kde se ceka identita
    const povoluje = vysledek === 'true' || (f.jmeno.startsWith('app_is') && vysledek === 'true');
    if (povoluje) helperPovoluje++;
    line(`  ${f.jmeno}${f.args ? '(…)' : '()'}`.padEnd(38) +
      `= ${String(vysledek).padEnd(26)} ${f.definer ? 'DEFINER' : 'INVOKER'}` +
      `${tvary.length ? '  tvary: ' + tvary.join(',') : ''}` +
      `${povoluje ? '   <-- POVOLUJE!' : ''}`);
  }
  await c.query('COMMIT');
} finally { c.release(); }

line(`\nhelperu celkem: ${fns.rows.length}; pri prazdnem kontextu POVOLUJE: ${helperPovoluje}`);

// ════════════════════════════════════════════════════════════════════════════
hdr('2) R-19: s cim se porovnava zbylych 126 sloupcu');

const TENANT_RE = '(^|_)(user|promoter|owner|account|buyer|organizer|actor|customer|member|tenant|partner|reseller|agent|seller|holder|recipient|sender|issuer|assignee)_id$';
const [cols, fks, pols] = await Promise.all([
  pool.query(`SELECT c.table_schema s, c.table_name t, c.column_name col
              FROM information_schema.columns c
              JOIN information_schema.tables tb ON tb.table_schema=c.table_schema AND tb.table_name=c.table_name AND tb.table_type='BASE TABLE'
              WHERE c.table_schema NOT IN ('pg_catalog','information_schema') AND c.column_name ~ $1`, [TENANT_RE]),
  pool.query(`SELECT tc.table_schema s, tc.table_name t, kcu.column_name col
              FROM information_schema.table_constraints tc
              JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema
              WHERE tc.constraint_type='FOREIGN KEY'`),
  pool.query(`SELECT schemaname s, tablename t, policyname p, COALESCE(qual,'')||' '||COALESCE(with_check,'') expr FROM pg_policies`),
]);
const fkSet = new Set(fks.rows.map((r) => `${r.s}.${r.t}.${r.col}`));
const polByTable = new Map();
for (const r of pols.rows) {
  const k = `${r.s}.${r.t}`;
  if (!polByTable.has(k)) polByTable.set(k, []);
  polByTable.get(k).push(r);
}

const UID = /app_current_user_id\s*\(|current_setting\s*\(\s*'app\.(current_)?user_id'/;
const PID = /app_current_promoter_id\s*\(|current_setting\s*\(\s*'app\.(current_)?promoter_id'/;

/** S cim se `col` porovnava — bere okno +-90 znaku kolem vyskytu. */
function sCim(expr, col) {
  const re = new RegExp(`\\b${col}\\b`, 'g');
  let m; const nalezy = new Set();
  while ((m = re.exec(expr)) !== null) {
    const o = expr.slice(Math.max(0, m.index - 90), m.index + col.length + 90);
    if (UID.test(o)) nalezy.add('GUC user');
    else if (PID.test(o)) nalezy.add('GUC promoter');
    else if (new RegExp(`\\b${col}\\b\\s*=\\s*[a-z_]+\\.[a-z_]+`).test(o) || /=\s*[a-z_]+\.[a-z_]+/.test(o)) nalezy.add('jiny sloupec');
    else nalezy.add('konstanta/jine');
  }
  return [...nalezy];
}

const skupiny = new Map();
const rizikove = [];
for (const r of cols.rows) {
  if (fkSet.has(`${r.s}.${r.t}.${r.col}`)) continue;
  const pol = (polByTable.get(`${r.s}.${r.t}`) ?? []).filter((x) => new RegExp(`\\b${r.col}\\b`).test(x.expr));
  if (!pol.length) continue;
  const kat = [...new Set(pol.flatMap((x) => sCim(x.expr, r.col)))].sort().join(' + ');
  skupiny.set(kat, (skupiny.get(kat) ?? 0) + 1);
  if (/GUC/.test(kat)) rizikove.push({ ...r, kat, pol: pol.map((x) => x.p) });
}

line('roztrideni podle toho, s cim se sloupec v policy porovnava:');
for (const [k, v] of [...skupiny].sort((a, b) => b[1] - a[1])) line(`  ${String(v).padStart(3)}  ${k}`);
line(`\nRIZIKOVE (porovnavaji se s GUC identity): ${rizikove.length}`);
for (const r of rizikove) line(`  ${r.s}.${r.t}.${r.col}  [${r.kat}]  ${r.pol.join(',')}`);

await pool.end();
