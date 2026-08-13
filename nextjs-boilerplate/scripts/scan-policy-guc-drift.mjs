#!/usr/bin/env node
/**
 * scan-policy-guc-drift.mjs — policies, ktere ctou GUC, jaky aplikace NIKDY
 * nenastavi. Takova vetev je trvale false => mrtva (fail-closed).
 *
 * Trida je dolozena dvakrat: R-53 (`transit_passes` cetl `app.platform_admin`
 * misto `app.is_platform_admin`, opraveno migraci 471) a R-19 nalez
 * `wero_payments` (`app.promoter_id` + `app.is_admin`).
 *
 * Aplikace nastavuje PRESNE tyhle ctyri (rls-pool.ts `applyGucs`):
 *   app.current_promoter_id, app.is_platform_admin, app.current_user_id, app.role
 *
 * SELF-CHECK (§54): zna dva pozitivni vzory (`app.promoter_id`, `app.is_admin`)
 * a jeden negativni (`app.current_user_id`). Kdyz je netrefi, exit 3.
 *
 *   node scripts/scan-policy-guc-drift.mjs <uri>
 */
import pg from 'pg';

const URI = process.argv[2];
if (!URI) { console.error('pouziti: scan-policy-guc-drift.mjs <uri>'); process.exit(2); }

const NASTAVOVANE = new Set([
  'app.current_promoter_id',
  'app.is_platform_admin',
  'app.current_user_id',
  'app.role',
]);

/** Vytahne vsechna jmena z `current_setting('X'...)` ve vyrazu. */
function gucVeVyrazu(expr) {
  const out = [];
  const re = /current_setting\s*\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(expr)) !== null) out.push(m[1]);
  return out;
}

// ── SELF-CHECK ──────────────────────────────────────────────────────────────
{
  const vzor = "((promoter_id = current_setting('app.promoter_id'::text, true))" +
    " OR (current_setting('app.is_admin'::text, true))::boolean" +
    " OR (user_id = current_setting('app.current_user_id'::text, true)))";
  const g = gucVeVyrazu(vzor);
  const drift = g.filter((x) => !NASTAVOVANE.has(x));
  const ok = drift.includes('app.promoter_id') && drift.includes('app.is_admin')
    && !drift.includes('app.current_user_id');
  if (!ok) {
    console.error(`SELF-CHECK SELHAL: nalezeno ${JSON.stringify(g)}, drift ${JSON.stringify(drift)} -> cisla NEPLATI.`);
    process.exit(3);
  }
  console.log('SELF-CHECK OK: dva znamé drifty nalezeny, spravne jmeno neoznaceno.\n');
}

/**
 * Obraci se fail-closed? NULL GUC normalne znamena „vetev neplati" => omezuje.
 * Tyhle tvary to ale OTACI — pak NULL znamena POVOLIT:
 *   NOT current_setting(...)          negace
 *   current_setting(...) IS NULL      primo testuje NULL
 *   <> / != / IS DISTINCT FROM        nerovnost projde, kdyz je jedna strana NULL? (u IS DISTINCT ano)
 *   COALESCE(current_setting(...), 'true')  default misto NULL
 */
function obraci(expr, guc) {
  const g = guc.replace(/\./g, '\\.');
  const cs = `current_setting\\s*\\(\\s*'${g}'[^)]*\\)`;
  const testy = [
    [new RegExp(`NOT\\s*\\(?\\s*(\\()?\\s*${cs}`, 'i'), 'NOT'],
    [new RegExp(`${cs}\\s*(::[a-z]+\\s*)?IS\\s+NULL`, 'i'), 'IS NULL'],
    [new RegExp(`${cs}\\s*(::[a-z]+\\s*)?IS\\s+DISTINCT\\s+FROM`, 'i'), 'IS DISTINCT FROM'],
    [new RegExp(`${cs}\\s*(::[a-z]+\\s*)?(<>|!=)`, 'i'), '<> / !='],
    [new RegExp(`(<>|!=)\\s*${cs}`, 'i'), '<> / != (obracene)'],
    [new RegExp(`COALESCE\\s*\\(\\s*${cs}\\s*,\\s*'?(true|t|1)'?`, 'i'), 'COALESCE s pravdivym defaultem'],
  ];
  return testy.filter(([re]) => re.test(expr)).map(([, jm]) => jm);
}

// SELF-CHECK pravidla obraceni
{
  const G = 'app.is_admin';
  const poz = [
    "(NOT (current_setting('app.is_admin'::text, true))::boolean)",
    "(current_setting('app.is_admin'::text, true) IS NULL)",
    "(current_setting('app.is_admin'::text, true) IS DISTINCT FROM 'x'::text)",
    "(current_setting('app.is_admin'::text, true) <> 'x'::text)",
    "(COALESCE(current_setting('app.is_admin'::text, true), 'true'::text) = 'true'::text)",
  ];
  const neg = "((current_setting('app.is_admin'::text, true))::boolean)";
  const vsechnyPoz = poz.every((e) => obraci(e, G).length > 0);
  const negOk = obraci(neg, G).length === 0;
  if (!vsechnyPoz || !negOk) {
    console.error(`SELF-CHECK 2 SELHAL (pozitivni=${poz.map((e) => obraci(e, G).length > 0).join(',')}, negativni=${negOk})`);
    process.exit(3);
  }
  console.log('SELF-CHECK 2 OK: vsech 5 obracejicich tvaru nalezeno, primy tvar neoznacen.\n');
}

const pool = new pg.Pool({ connectionString: URI, max: 2 });
const { rows } = await pool.query(
  `SELECT schemaname AS s, tablename AS t, policyname AS p, permissive AS perm, cmd,
          COALESCE(qual,'') || ' ' || COALESCE(with_check,'') AS expr
   FROM pg_policies`,
);

const pouzita = new Map();      // guc -> pocet policies
const postizene = [];
for (const r of rows) {
  const g = [...new Set(gucVeVyrazu(r.expr))];
  for (const x of g) pouzita.set(x, (pouzita.get(x) ?? 0) + 1);
  const drift = g.filter((x) => !NASTAVOVANE.has(x));
  if (drift.length) postizene.push({ ...r, drift });
}

console.log(`policies celkem                : ${rows.length}`);
console.log(`ruznych jmen GUC v policies    : ${pouzita.size}`);
console.log('\nvsechna jmena a pocet policies, ktere je ctou:');
for (const [k, v] of [...pouzita].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${NASTAVOVANE.has(k) ? 'OK    ' : 'DRIFT '} ${k.padEnd(28)} ${v}`);
}

console.log(`\nPOLICIES S DRIFTEM: ${postizene.length}`);

const podezrele = [];
for (const r of postizene) {
  const duvody = [];
  for (const g of r.drift) {
    const o = obraci(r.expr, g);
    if (o.length) duvody.push(`${g}: ${o.join(' + ')}`);
  }
  if (String(r.perm).toUpperCase().startsWith('R')) duvody.push('RESTRICTIVE policy');
  if (duvody.length) podezrele.push({ ...r, duvody });
}

console.log(`\n=== OTACI SE nekde fail-closed? ===`);
console.log(`podezrelych: ${podezrele.length} z ${postizene.length}`);
for (const r of podezrele) {
  console.log(`  ${r.s}.${r.t}  ${r.p}  [${r.perm}/${r.cmd}]`);
  for (const d of r.duvody) console.log(`      ${d}`);
  console.log(`      vyraz: ${r.expr.trim().slice(0, 300)}`);
}

console.log('\n=== permissive/restrictive rozlozeni u driftovanych ===');
const perm = {};
for (const r of postizene) perm[r.perm] = (perm[r.perm] ?? 0) + 1;
console.log('  ' + JSON.stringify(perm));

console.log('\n=== app.platform_admin (spor s R-53) ===');
for (const r of postizene.filter((x) => x.drift.includes('app.platform_admin'))) {
  console.log(`  ${r.s}.${r.t}  ${r.p}  [${r.perm}/${r.cmd}]`);
  console.log(`      ${r.expr.trim().slice(0, 400)}`);
}

console.log('\n=== vsech 39 (tabulka | policy | drift) ===');
for (const r of postizene) console.log(`  ${r.s}.${r.t} | ${r.p} | ${r.drift.join(',')}`);

await pool.end();
