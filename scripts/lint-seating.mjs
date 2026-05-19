#!/usr/bin/env node
/**
 * lint-seating.mjs — CI-friendly audit všech aktivních seating chartů z DB.
 *
 * 1. Stáhne všechny aktivní charty z catalog.venue_seating_charts
 * 2. Pro každý spustí check-overlaps (auto-mode = render radius z pitch)
 * 3. Vypíše tabulku layoutů + kolizí
 * 4. Exit code 0 pokud všechny 0 kolizí, 1 pokud cokoliv má kolize
 *
 * Použití v CI:
 *   npm run lint:seating
 *   # nebo: node scripts/lint-seating.mjs
 *
 * Pre-merge gate: zabraňuje merge layoutu s kolizemi.
 */

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
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
           v.name AS venue_name
      FROM catalog.venue_seating_charts vsc
      JOIN catalog.venues v ON v.id = vsc.venue_id
     WHERE vsc.active = TRUE
     ORDER BY vsc.total_seats DESC NULLS LAST
  `);
  await pool.end();

  if (res.rows.length === 0) {
    console.log('No active charts found.');
    return;
  }

  // Dočasný adresář pro layout JSONy
  const tmpDir = mkdtempSync(join(tmpdir(), 'tixly-seating-lint-'));

  console.log(`\nLint seating audit — ${res.rows.length} aktivních chartů\n`);
  console.log('Layout                                    Seats    Pitch    Kolize  Stav');
  console.log('────────────────────────────────────────  ──────   ──────   ──────  ────');

  let failed = 0;
  for (const row of res.rows) {
    const slug = slugify(row.venue_name);
    const layoutPath = join(tmpDir, `${slug}.json`);
    writeFileSync(layoutPath, JSON.stringify(row.layout), 'utf8');

    const check = spawnSync('node', [join(__dirname, 'check-overlaps.mjs'), layoutPath], {
      encoding: 'utf8',
    });
    const output = check.stdout ?? '';
    const pitchMatch = /pitch=([0-9.]+)/.exec(output);
    const collisionMatch = /(\d+)\s+collision pair/.exec(output);
    const noOverlap = /No overlaps detected/.test(output);
    const tightMatch = /(\d+)\s+pairs are visually tight/.exec(output);

    const pitch = pitchMatch ? pitchMatch[1] : '?';
    const collisions = collisionMatch ? parseInt(collisionMatch[1], 10) : 0;
    const tight = tightMatch ? parseInt(tightMatch[1], 10) : 0;
    const ok = noOverlap || (collisions === 0 && check.status === 0);

    const status = ok ? (tight > 0 ? `⚠ ${tight} tight` : '✅') : `❌ ${collisions}`;
    const name = row.venue_name.padEnd(40).slice(0, 40);
    const seats = String(row.total_seats ?? '?').padStart(6);
    const pitchStr = pitch.padStart(6);
    const colStr = String(collisions).padStart(6);

    console.log(`${name}  ${seats}   ${pitchStr}   ${colStr}  ${status}`);

    if (!ok) failed++;
  }

  rmSync(tmpDir, { recursive: true, force: true });

  console.log('');
  if (failed > 0) {
    console.log(`❌ FAILED: ${failed} layout(s) má kolize. Spusť check-overlaps.mjs pro detail.`);
    process.exit(1);
  } else {
    console.log(`✅ All ${res.rows.length} layouts have 0 collisions.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
