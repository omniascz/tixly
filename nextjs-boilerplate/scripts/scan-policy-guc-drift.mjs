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

const pool = new pg.Pool({ connectionString: URI, max: 2 });
const { rows } = await pool.query(
  `SELECT schemaname AS s, tablename AS t, policyname AS p,
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
for (const r of postizene) {
  console.log(`  ${r.s}.${r.t}  ${r.p}`);
  console.log(`      drift: ${r.drift.join(', ')}`);
  console.log(`      vyraz: ${r.expr.trim().slice(0, 160)}`);
}

await pool.end();
