/**
 * Seedne Městské divadlo Bílina do dev DB s plným seating chartem (372 míst).
 *
 * Spuštění:  node scripts/seed-bilina-venue.mjs
 *
 * Co dělá:
 *   1. Vytvoří nebo update venue v catalog.venues
 *   2. Konvertuje docs/bilina-seating.csv do layout JSON
 *   3. INSERT do catalog.venue_seating_charts (active=true)
 *   4. Vypíše venue_id pro otevření v master admin UI
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CSV = join(ROOT, 'docs', 'bilina-seating.csv');

const pool = new pg.Pool({
  connectionString: 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
});

const VENUE_NAME = 'Městské divadlo Bílina';
const VENUE_CITY = 'Bílina';
const VENUE_ADDRESS = 'Mírové náměstí 87, 418 01 Bílina';
const CAPACITY = 372;

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const header = lines[0].split(',');
  const idx = {
    sector: header.indexOf('sector'),
    row: header.indexOf('row'),
    num: header.indexOf('num'),
    x: header.indexOf('x'),
    y: header.indexOf('y'),
    accessibility: header.indexOf('accessibility'),
  };
  const seats = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    if (parts.length < 5) continue;
    seats.push({
      sector: parts[idx.sector],
      row: parts[idx.row],
      num: parts[idx.num],
      x: Number(parts[idx.x]),
      y: Number(parts[idx.y]),
      accessibility: parts[idx.accessibility] === 'true',
    });
  }
  return seats;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function buildLayout(seats) {
  const SECTOR_COLORS = {
    'Balkón': '#3b82f6',
    'Přízemí': '#10b981',
  };
  const sectorMap = new Map();
  for (const s of seats) {
    if (!sectorMap.has(s.sector)) {
      sectorMap.set(s.sector, new Map());
    }
    const rowMap = sectorMap.get(s.sector);
    if (!rowMap.has(s.row)) {
      rowMap.set(s.row, []);
    }
    rowMap.get(s.row).push({
      num: s.num,
      x: s.x,
      y: s.y,
      ...(s.accessibility ? { accessibility: true } : {}),
    });
  }
  const sectors = [];
  for (const [sectorName, rowMap] of sectorMap) {
    const rows = [];
    // Sort rows by label as number desc (řada 13 first, řada 1 last for přízemí;
    // řada 8 first, řada 1 last for balkón) — tohle není kritické, jen visual
    const sortedRowLabels = [...rowMap.keys()].sort((a, b) => Number(b) - Number(a));
    for (const label of sortedRowLabels) {
      rows.push({ label, seats: rowMap.get(label) });
    }
    sectors.push({
      name: sectorName,
      color: SECTOR_COLORS[sectorName] ?? '#8b5cf6',
      rows,
    });
  }
  return {
    viewBox: '0 0 1200 900',
    sectors,
    stage: { position: 'top', label: 'Pódium Městské divadlo' },
  };
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    // 1) Find or create venue
    const exist = await client.query(
      `SELECT id FROM catalog.venues WHERE name = $1 AND city = $2`,
      [VENUE_NAME, VENUE_CITY],
    );
    let venueId;
    if (exist.rows.length > 0) {
      venueId = exist.rows[0].id;
      console.log(`✓ Venue už existuje: ${venueId}`);
    } else {
      const ins = await client.query(
        `INSERT INTO catalog.venues
           (name, city, country, address, capacity, venue_type, status, description)
         VALUES ($1, $2, 'CZ', $3, $4, 'theatre_hall', 'published',
                 'Klasické divadlo s balkónem, 372 míst (228 přízemí + 144 balkón). Při digitální projekci se balkón uzavírá.')
         RETURNING id`,
        [VENUE_NAME, VENUE_CITY, VENUE_ADDRESS, CAPACITY],
      );
      venueId = ins.rows[0].id;
      console.log(`✓ Venue vytvořeno: ${venueId}`);
    }

    // 2) Parse CSV → layout
    const csv = readFileSync(CSV, 'utf8');
    const seats = parseCsv(csv);
    console.log(`✓ CSV načteno: ${seats.length} sedadel`);

    const layout = buildLayout(seats);
    console.log(`✓ Layout sestaven: ${layout.sectors.length} sektorů`);
    for (const sec of layout.sectors) {
      const seatCount = sec.rows.reduce((acc, r) => acc + r.seats.length, 0);
      console.log(`    ${sec.name}: ${sec.rows.length} řad, ${seatCount} sedadel`);
    }

    // 3) Deactivate existing charts for this venue
    await client.query(
      `UPDATE catalog.venue_seating_charts
          SET active = false
        WHERE venue_id = $1 AND active = true`,
      [venueId],
    );

    // 4) Insert new chart
    const chart = await client.query(
      `INSERT INTO catalog.venue_seating_charts
         (venue_id, name, layout, total_seats, active, source, notes)
       VALUES ($1, $2, $3::jsonb, $4, true, 'csv-import',
               'Import z bilina-seating.csv, generated by Claude AI z PDF plánku 2026-05-23')
       RETURNING id`,
      [venueId, 'Bílina Default 2026', JSON.stringify(layout), seats.length],
    );
    console.log(`✓ Chart vytvořen: ${chart.rows[0].id}`);

    await client.query('COMMIT');

    console.log(`\n🎟  Venue připraveno pro master admin!`);
    console.log(`\n📍 OPEN:  http://localhost:3000/platform/venues/${venueId}/edit`);
    console.log(`📍 CHART: http://localhost:3000/platform/venues/${venueId}/seating-chart`);
    console.log(`📍 EDITOR: http://localhost:3000/platform/venues/${venueId}/seating-chart/editor`);
    console.log(`\n👤 LOGIN credentials:`);
    console.log(`   email:    superadmin@tixly.cz`);
    console.log(`   heslo:    Demo2026!`);
    console.log(`   URL:      http://localhost:3000/cs/login`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('✗ Chyba:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
