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
  `SELECT e.id, e.title, e.status, e.created_at,
          COUNT(es.id) AS seats,
          COUNT(DISTINCT es.ticket_type_id) AS tt_mapped
   FROM catalog.events e
   LEFT JOIN catalog.event_seats es ON es.event_id = e.id
   WHERE e.title LIKE 'PWT Test%'
   GROUP BY e.id, e.title, e.status, e.created_at
   ORDER BY e.created_at DESC
   LIMIT 5`,
);
for (const row of r.rows) {
  console.log(
    `${row.id.slice(0, 8)}…  ${row.title.padEnd(35)}  ${row.status.padEnd(15)}  seats=${row.seats}  tt=${row.tt_mapped}`,
  );
}
await pool.end();
