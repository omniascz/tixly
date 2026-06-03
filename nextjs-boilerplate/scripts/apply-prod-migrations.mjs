/**
 * Aplikuje BUNDLE_340-348_prod.sql na produkční DB.
 * Použití:  PROD_DATABASE_URL="postgres://..." node scripts/apply-prod-migrations.mjs
 *
 * Bezpečné: bundle je v BEGIN/COMMIT (vše nebo nic), migrace idempotentní.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.PROD_DATABASE_URL;
if (!url) { console.error('❌ Nastav PROD_DATABASE_URL'); process.exit(1); }
const sql = readFileSync(new URL('../../migrations/BUNDLE_340-348_prod.sql', import.meta.url), 'utf8');

const pool = new pg.Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
try {
  // Ověř připojení + aktuální stav vybraných objektů PŘED
  const before = await pool.query(`SELECT
    (SELECT column_default FROM information_schema.columns WHERE table_schema='platform' AND table_name='promoters' AND column_name='id') AS promoters_id_default,
    (SELECT COUNT(*)::int FROM pg_policy WHERE polname LIKE 'svc_%') AS svc_policies`);
  console.log('PŘED:', JSON.stringify(before.rows[0]));

  await pool.query(sql);  // bundle obsahuje BEGIN/COMMIT
  console.log('✅ BUNDLE 340-348 aplikován');

  const after = await pool.query(`SELECT
    (SELECT column_default FROM information_schema.columns WHERE table_schema='platform' AND table_name='promoters' AND column_name='id') AS promoters_id_default,
    (SELECT COUNT(*)::int FROM pg_policy WHERE polname LIKE 'svc_%') AS svc_policies,
    (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='audit_log_actor_type_check') AS audit_constraint`);
  console.log('PO:', JSON.stringify(after.rows[0]));
  console.log(after.rows[0].promoters_id_default ? '✅ promoters.id má default' : '❌ promoters.id BEZ defaultu');
  console.log(`✅ ${after.rows[0].svc_policies} service-bypass policies`);
} catch (e) {
  console.error('❌ CHYBA (rollback proběhl):', e.message);
  process.exit(1);
} finally { await pool.end(); }
