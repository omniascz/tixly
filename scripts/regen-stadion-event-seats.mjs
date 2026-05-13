// Regeneruje catalog.event_seats pro eventy na stadionu po patchi layoutu.
// Replikuje copyLayoutToEventSeats z TS modulu, ale s batch INSERT pro výkon.
//
// Spustit po patch-stadion-layout.mjs.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromApp = createRequire(join(__dirname, '..', 'nextjs-boilerplate', 'noop.js'));
const pg = requireFromApp('pg');

const STADIUM_VENUE_ID = '00000000-0000-4000-a000-000000000204';
const BATCH_SIZE = 2000; // řádků na jeden INSERT

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
});

async function main() {
  const client = await pool.connect();
  try {
    const events = await client.query(
      `SELECT id, title FROM catalog.events WHERE venue_id = $1`,
      [STADIUM_VENUE_ID],
    );
    if (events.rows.length === 0) {
      console.log('No events on stadium venue, nothing to do.');
      return;
    }

    const layoutRes = await client.query(
      `SELECT layout FROM catalog.venue_seating_charts
       WHERE venue_id = $1 AND active = true
       ORDER BY created_at DESC LIMIT 1`,
      [STADIUM_VENUE_ID],
    );
    const layout = layoutRes.rows[0]?.layout;
    if (!layout || !Array.isArray(layout.sectors)) {
      throw new Error('Layout missing or empty');
    }

    for (const event of events.rows) {
      console.log(`\n→ ${event.id}  ${event.title}`);
      await regenerateForEvent(client, event.id, layout);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

async function regenerateForEvent(client, eventId, layout) {
  const ttRes = await client.query(
    `SELECT id, zone FROM catalog.ticket_types WHERE event_id = $1`,
    [eventId],
  );
  const ticketTypes = ttRes.rows;
  console.log(`  ticket_types: ${ticketTypes.length}`);
  for (const t of ticketTypes) console.log(`    · zone='${t.zone}' id=${t.id}`);

  function findTicketTypeId(sectorName) {
    if (ticketTypes.length === 0) return null;
    const exact = ticketTypes.find((t) => t.zone === sectorName);
    if (exact) return exact.id;
    const prefixCandidates = ticketTypes
      .filter((t) => t.zone && sectorName.startsWith(t.zone))
      .sort((a, b) => (b.zone ?? '').length - (a.zone ?? '').length);
    if (prefixCandidates[0]) return prefixCandidates[0].id;
    // Fallback: žádný zone match — vezmeme první ticket type (pro standing eventy
    // nebo když promotér nezadal zone). Bez fallbacku zůstane mapa prázdná.
    return ticketTypes[0]?.id ?? null;
  }

  // Posbírej všechny seat řádky
  const allRows = [];
  let matchedSectors = 0;
  const skippedSectors = [];
  for (const sector of layout.sectors) {
    const ticketTypeId = findTicketTypeId(sector.name);
    if (!ticketTypeId) {
      skippedSectors.push(sector.name);
      continue;
    }
    matchedSectors++;
    for (const row of sector.rows ?? []) {
      for (const seat of row.seats ?? []) {
        allRows.push([
          eventId,
          ticketTypeId,
          sector.name,
          row.label,
          seat.num,
          seat.x ?? null,
          seat.y ?? null,
          seat.acc === true,
        ]);
      }
    }
  }

  console.log(`  matched sectors: ${matchedSectors}, skipped: ${skippedSectors.length}, seats to insert: ${allRows.length}`);

  await client.query('BEGIN');
  try {
    let inserted = 0;
    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
      const batch = allRows.slice(i, i + BATCH_SIZE);
      const values = [];
      const params = [];
      batch.forEach((row, idx) => {
        const off = idx * 8;
        values.push(`($${off+1},$${off+2},$${off+3},$${off+4},$${off+5},$${off+6},$${off+7},'available',$${off+8})`);
        params.push(...row);
      });
      const r = await client.query(
        `INSERT INTO catalog.event_seats
           (event_id, ticket_type_id, sector, row, seat_number, x_coord, y_coord, status, accessibility)
         VALUES ${values.join(',')}
         ON CONFLICT (event_id, event_day_id, sector, row, seat_number) DO NOTHING`,
        params,
      );
      inserted += r.rowCount ?? 0;
      process.stdout.write(`\r  inserted ${inserted}/${allRows.length}`);
    }
    process.stdout.write('\n');
    await client.query('COMMIT');
    console.log(`  ✓ event_seats: ${inserted} řádků`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
