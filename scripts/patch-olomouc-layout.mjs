// patch-olomouc-layout.mjs
//
// 1) UPDATE catalog.venue_seating_charts.layout (Olomouc chart 304)
// 2) DELETE event_seats pro eventy na venue 205
// 3) Pro každý event: insert event_seats z layoutu mapováním sektor → ticket_type.zone
//
// Spustit:  node scripts/patch-olomouc-layout.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromApp = createRequire(join(__dirname, '..', 'nextjs-boilerplate', 'noop.js'));
const pg = requireFromApp('pg');

const VENUE_ID = '00000000-0000-4000-a000-000000000205';
const CHART_ID = '00000000-0000-4000-a000-000000000304';
const LAYOUT_PATH = join(__dirname, 'layouts', 'stadion-12k-x2.json');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
});

async function copyLayoutToEventSeats(client, eventId, layout) {
  // Tickety pro tento event
  const ttRes = await client.query(
    `SELECT id, zone FROM catalog.ticket_types WHERE event_id = $1 AND zone IS NOT NULL`,
    [eventId],
  );
  const ticketTypes = ttRes.rows;

  // Sektor → ticket_type mapping (exact > nejdelší prefix)
  function findTicketType(sectorName) {
    const exact = ticketTypes.find((tt) => tt.zone === sectorName);
    if (exact) return exact.id;
    const prefixed = ticketTypes
      .filter((tt) => sectorName.startsWith(tt.zone))
      .sort((a, b) => b.zone.length - a.zone.length)[0];
    return prefixed ? prefixed.id : null;
  }

  let inserted = 0;
  let matched = 0;
  const skipped = [];

  for (const sector of layout.sectors ?? []) {
    const ttId = findTicketType(sector.name);
    if (!ttId) {
      skipped.push(sector.name);
      continue;
    }
    matched++;
    // Batch insert per sektor
    const values = [];
    const params = [];
    let p = 1;
    for (const row of sector.rows ?? []) {
      for (const seat of row.seats ?? []) {
        values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'available')`);
        params.push(eventId, ttId, sector.name, row.label, seat.num, seat.x ?? 0, seat.y ?? 0);
      }
    }
    if (values.length === 0) continue;
    // INSERT v chunkách max 1000 rows per query
    const CHUNK = 1000;
    for (let i = 0; i < values.length; i += CHUNK) {
      const chunkValues = values.slice(i, i + CHUNK);
      const chunkParams = params.slice(i * 7, (i + CHUNK) * 7);
      await client.query(
        `INSERT INTO catalog.event_seats
           (event_id, ticket_type_id, sector, row, seat_number, x_coord, y_coord, status)
         VALUES ${chunkValues.join(', ')}`,
        chunkParams,
      );
      inserted += chunkValues.length;
    }
  }
  return { inserted, matched, skipped };
}

async function main() {
  const layoutJson = readFileSync(LAYOUT_PATH, 'utf8');
  const layout = JSON.parse(layoutJson);
  const totalSeats = layout.sectors.reduce(
    (sum, s) => sum + s.rows.reduce((a, r) => a + r.seats.length, 0),
    0,
  );
  console.log(`Loaded layout: ${layout.sectors.length} sectors, ${totalSeats} seats`);
  console.log(`viewBox: ${layout.viewBox}\n`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) UPDATE chart
    const u = await client.query(
      `UPDATE catalog.venue_seating_charts
         SET layout = $2::jsonb, total_seats = $3
       WHERE id = $1
       RETURNING name`,
      [CHART_ID, layoutJson, totalSeats],
    );
    if (u.rows.length === 0) {
      throw new Error(`Chart ${CHART_ID} not found`);
    }
    console.log(`[chart] updated "${u.rows[0].name}" — ${totalSeats} seats`);

    // 2) Najdi eventy + smaž event_seats
    const events = await client.query(
      `SELECT id, title FROM catalog.events WHERE venue_id = $1`,
      [VENUE_ID],
    );
    console.log(`[events] ${events.rows.length} event(ů) na venue ${VENUE_ID}`);
    for (const e of events.rows) console.log(`  · ${e.id}  ${e.title}`);

    if (events.rows.length > 0) {
      const ids = events.rows.map((e) => e.id);
      const del = await client.query(
        `DELETE FROM catalog.event_seats WHERE event_id = ANY($1::uuid[])`,
        [ids],
      );
      console.log(`[event_seats] smazáno ${del.rowCount} starých řádků\n`);

      // 3) Regenerate per event
      for (const e of events.rows) {
        const result = await copyLayoutToEventSeats(client, e.id, layout);
        console.log(
          `[regen] ${e.title}: ${result.matched} sektorů, ${result.inserted} sedadel${
            result.skipped.length ? `, skipped: ${result.skipped.join(', ')}` : ''
          }`,
        );
      }
    }

    await client.query('COMMIT');
    console.log('\n✓ Hotovo.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
