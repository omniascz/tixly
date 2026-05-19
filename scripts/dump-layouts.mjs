#!/usr/bin/env node
/**
 * Stáhne všechny aktivní seating charty z DB a uloží jako JSON
 * do scripts/layouts-from-db/{slug}.json
 *
 * Použití: node scripts/dump-layouts.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'layouts-from-db');
mkdirSync(OUT_DIR, { recursive: true });

const requireFromApp = createRequire(join(__dirname, '..', 'nextjs-boilerplate', 'noop.js'));
const pg = requireFromApp('pg');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
});

function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  const res = await pool.query(`
    SELECT vsc.id, vsc.name AS chart_name, vsc.layout, vsc.total_seats,
           v.id AS venue_id, v.name AS venue_name, v.city
      FROM catalog.venue_seating_charts vsc
      JOIN catalog.venues v ON v.id = vsc.venue_id
     WHERE vsc.active = TRUE
     ORDER BY vsc.total_seats DESC NULLS LAST
  `);

  console.log(`Found ${res.rows.length} active charts.\n`);

  for (const row of res.rows) {
    const slug = slugify(row.venue_name);
    const file = join(OUT_DIR, `${slug}.json`);
    writeFileSync(file, JSON.stringify(row.layout, null, 2), 'utf8');
    console.log(`  ${row.total_seats?.toString().padStart(6) ?? '   ???'} seats → ${slug}.json   [${row.venue_name}]`);
  }

  await pool.end();
  console.log(`\nSaved to ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
