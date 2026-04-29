#!/usr/bin/env node
/**
 * One-time migrace: opravuje password_hash pro všechny demo accounty,
 * které phase1/phase4 seedovaly s placeholder hashem (neodpovídal Demo2026!).
 *
 * Spuštění: node scripts/migrate-demo-passwords.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(
  join(__dirname, '..', 'nextjs-boilerplate', '.env.local'),
  'utf8',
).split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const req = createRequire(join(__dirname, '..', 'nextjs-boilerplate', 'noop.js'));
const pg = req('pg');
const bcrypt = req('bcryptjs');
const PLACEHOLDER = '$2b$10$rXsLkqLnNxz5W1hQMTkHKuGq5x9V4/gDBXmkY1Y4tF8Wp0hGgZbsi';
const NEW_HASH = await bcrypt.hash('Demo2026!', 10);

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const r = await pool.query(
  `UPDATE identity.users SET password_hash = $1, updated_at = NOW()
   WHERE password_hash = $2
   RETURNING email`,
  [NEW_HASH, PLACEHOLDER],
);
console.log(`Updated ${r.rowCount} users:`);
for (const row of r.rows) console.log(' ', row.email);
await pool.end();
