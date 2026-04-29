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
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

const r = await pool.query(
  `SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_schema = 'catalog' AND table_name IN ('ticket_types', 'event_seats')
   ORDER BY table_name, ordinal_position`,
);
let lastTable = '';
for (const row of r.rows) {
  const tbl = row.column_name.startsWith('row') ? 'event_seats' : '';
  if (tbl !== lastTable && tbl) {
    console.log(`\n--- ${tbl} ---`);
    lastTable = tbl;
  }
  console.log(`${row.column_name.padEnd(28)} ${row.data_type.padEnd(20)} ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
}
await pool.end();
