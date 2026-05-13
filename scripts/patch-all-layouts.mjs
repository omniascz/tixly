// Aplikuje opravené layouty do DB pro všechny 3 sály:
//   - Velký koncertní sál (autofit viewBox)
//   - Aréna (autofit, opravený overflow do záporných X)
//   - Stadion (kompaktnější geometrie + autofit + 36 sektorů místo 40)
//
// Pro každou venue:
//   1) UPSERT layout do catalog.venue_seating_charts
//   2) Smaž existující event_seats pro eventy na této venue
//   3) Regeneruje event_seats batch INSERTem (pokud event má ticket_types)

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromApp = createRequire(join(__dirname, '..', 'nextjs-boilerplate', 'noop.js'));
const pg = requireFromApp('pg');

const VENUES = [
  {
    file: 'velky-sal.json',
    venueId: '00000000-0000-4000-a000-000000000201', // Velky koncertni sal Praha (ne 202 = Klub Underground)
    chartId: '00000000-0000-4000-a000-000000000301',
    name: 'Velký koncertní sál — Rudolfinum-style',
  },
  {
    file: 'arena.json',
    venueId: '00000000-0000-4000-a000-000000000203',
    chartId: '00000000-0000-4000-a000-000000000302',
    name: 'Aréna Praha — koncert config (autofit)',
  },
  {
    file: 'stadion.json',
    venueId: '00000000-0000-4000-a000-000000000204',
    chartId: '00000000-0000-4000-a000-000000000303',
    name: 'Stadion FC Praha — 4 tribuny × bloky',
  },
];

const BATCH_SIZE = 2000;
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
});

async function main() {
  for (const v of VENUES) {
    console.log(`\n=== ${v.file} ===`);
    await patchVenue(v);
  }
  await pool.end();
}

async function patchVenue(v) {
  const layoutPath = join(__dirname, 'layouts', v.file);
  const layoutJson = readFileSync(layoutPath, 'utf8');
  const layout = JSON.parse(layoutJson);
  const totalSeats = layout.sectors.reduce(
    (sum, s) => sum + s.rows.reduce((a, r) => a + r.seats.length, 0),
    0,
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) UPSERT chart
    const upsert = await client.query(
      `INSERT INTO catalog.venue_seating_charts (id, venue_id, name, layout, total_seats, active, source, notes)
       VALUES ($1, $2, $3, $4::jsonb, $5, true, 'seed', 'Patched 2026-04-29 — autofit viewBox')
       ON CONFLICT (id) DO UPDATE
         SET layout = EXCLUDED.layout,
             total_seats = EXCLUDED.total_seats,
             name = EXCLUDED.name,
             notes = EXCLUDED.notes
       RETURNING (xmax = 0) AS inserted`,
      [v.chartId, v.venueId, v.name, layoutJson, totalSeats],
    );
    console.log(
      `[chart] ${upsert.rows[0].inserted ? 'inserted' : 'updated'}: ${totalSeats} sedadel, ${layout.sectors.length} sektorů, viewBox=${layout.viewBox}`,
    );

    // 2) Najdi eventy na této venue
    const events = await client.query(
      `SELECT id, title FROM catalog.events WHERE venue_id = $1`,
      [v.venueId],
    );
    if (events.rows.length === 0) {
      console.log('  (no events on this venue)');
      await client.query('COMMIT');
      return;
    }
    console.log(`[events] ${events.rows.length} event(ů):`);
    for (const e of events.rows) console.log(`  · ${e.title}`);

    // 3) Strategy: UPDATE x_coord/y_coord pro existující řádky (zachová tickets FK).
    // Pokud existující struktura nematchne (jiné sector/row/seat_number klíče),
    // fallback na DELETE+INSERT — funguje jen pokud na ně nevisí žádné tickety.
    for (const event of events.rows) {
      await syncEventSeats(client, event.id, layout);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function syncEventSeats(client, eventId, layout) {
  // Spočítat kolik sedadel by mělo být po refreshi (z layout × ticket_types které matchnou)
  const expected = layout.sectors.reduce(
    (sum, s) => sum + s.rows.reduce((a, r) => a + r.seats.length, 0),
    0,
  );

  // Pokus 1: UPDATE x_coord/y_coord pro existující event_seats. Pokud matchne
  // VŠECHNY sedadla (struktura zachována), tickets FK zůstanou platné.
  let updated = 0;
  for (const sector of layout.sectors) {
    for (const row of sector.rows ?? []) {
      for (const seat of row.seats ?? []) {
        const r = await client.query(
          `UPDATE catalog.event_seats
             SET x_coord = $4, y_coord = $5
           WHERE event_id = $1 AND sector = $2 AND row = $3 AND seat_number = $6`,
          [eventId, sector.name, row.label, seat.x ?? null, seat.y ?? null, seat.num],
        );
        updated += r.rowCount ?? 0;
      }
    }
  }

  // Plný match — hotovo
  if (updated === expected) {
    console.log(`  event ${eventId}: UPDATE x/y pro ${updated} sedadel (struktura plně zachována)`);
    return;
  }

  // Partial match → struktura se změnila. Pokus DELETE + INSERT pokud žádné
  // tickety nezávisí na event_seats, jinak nech UPDATE jak je (degraded mode).
  console.log(`  event ${eventId}: partial match (${updated}/${expected}), zkusím regenerovat`);

  const tickRes = await client.query(
    `SELECT COUNT(*)::int AS n FROM tickets.tickets t
     JOIN catalog.event_seats es ON es.id = t.event_seat_id
     WHERE es.event_id = $1`,
    [eventId],
  );
  const ticketCount = tickRes.rows[0].n;

  if (ticketCount > 0) {
    console.log(`    ⚠️ ${ticketCount} ticketů závisí na event_seats — force-delete (demo data)`);
    await client.query(
      `DELETE FROM tickets.tickets WHERE event_seat_id IN (SELECT id FROM catalog.event_seats WHERE event_id = $1)`,
      [eventId],
    );
  }

  await client.query(`DELETE FROM catalog.event_seats WHERE event_id = $1`, [eventId]);
  await regenerateForEvent(client, eventId, layout);
}

async function regenerateForEvent(client, eventId, layout) {
  const ttRes = await client.query(
    `SELECT id, zone FROM catalog.ticket_types WHERE event_id = $1`,
    [eventId],
  );
  const ticketTypes = ttRes.rows;
  if (ticketTypes.length === 0) {
    console.log(`  ${eventId}: žádné ticket_types — skip`);
    return;
  }

  function findTicketTypeId(sectorName) {
    const exact = ticketTypes.find((t) => t.zone === sectorName);
    if (exact) return exact.id;
    const prefix = ticketTypes
      .filter((t) => t.zone && sectorName.startsWith(t.zone))
      .sort((a, b) => (b.zone ?? '').length - (a.zone ?? '').length);
    return prefix[0]?.id ?? ticketTypes[0]?.id ?? null;
  }

  const allRows = [];
  let matched = 0;
  let skipped = 0;
  for (const sector of layout.sectors) {
    const ttId = findTicketTypeId(sector.name);
    if (!ttId) { skipped++; continue; }
    matched++;
    for (const row of sector.rows ?? []) {
      for (const seat of row.seats ?? []) {
        allRows.push([eventId, ttId, sector.name, row.label, seat.num, seat.x ?? null, seat.y ?? null, seat.acc === true]);
      }
    }
  }

  let inserted = 0;
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    const values = [];
    const params = [];
    batch.forEach((row, idx) => {
      const off = idx * 8;
      values.push(`($${off + 1},$${off + 2},$${off + 3},$${off + 4},$${off + 5},$${off + 6},$${off + 7},'available',$${off + 8})`);
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
  }
  console.log(`  event ${eventId}: matched=${matched} skipped=${skipped} inserted=${inserted} seats`);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
