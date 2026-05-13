// scripts/seed-event-celetna-premiera.mjs
//
// Vytvoří demo událost Divadla Verze: „Eddie & Vanessa — premiéra"
// v Hlavním sále Celetné, ticket_type Plné vstupné 390 Kč zone=HLEDIŠTĚ.
// Vyrobí 117 event_seats. Idempotentní (UPSERT na fix UUID).
//
// Po seedu by Divadlo Verze v `/cs/admin` mělo vidět tuhle akci,
// buyer ji najde v `/cs/events/{id}` a může jít na SeatPicker.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromApp = createRequire(join(__dirname, '..', 'nextjs-boilerplate', 'noop.js'));
const pg = requireFromApp('pg');

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
});

const EVENT_ID       = '00000000-0000-4000-a000-000000000700';
const TICKET_TYPE_ID = '00000000-0000-4000-a000-000000000701';
const PROMOTER_ID    = '00000000-0000-4000-a000-000000000115'; // Divadlo Verze
const VENUE_ID       = '00000000-0000-4000-a000-000000000500'; // Hlavní sál
const USER_ID        = '00000000-0000-4000-a000-000000000115'; // verze@…

// Datum konání — za 21 dní v 19:30
const eventDate = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
eventDate.setHours(19, 30, 0, 0);

async function copyLayoutToSeats(client, eventId) {
  const v = await client.query(
    `SELECT venue_id FROM catalog.events WHERE id = $1`,
    [eventId],
  );
  const venueId = v.rows[0]?.venue_id;
  const l = await client.query(
    `SELECT layout FROM catalog.venue_seating_charts
       WHERE venue_id = $1 AND active = true
       ORDER BY created_at DESC LIMIT 1`,
    [venueId],
  );
  const layout = l.rows[0]?.layout;
  if (!layout) return 0;

  const tt = await client.query(
    `SELECT id, zone FROM catalog.ticket_types WHERE event_id = $1 AND zone IS NOT NULL`,
    [eventId],
  );
  const types = tt.rows;
  const findId = (sectorName) => {
    const exact = types.find((t) => t.zone === sectorName);
    if (exact) return exact.id;
    const prefix = types
      .filter((t) => t.zone && sectorName.startsWith(t.zone))
      .sort((a, b) => (b.zone ?? '').length - (a.zone ?? '').length);
    return prefix[0]?.id ?? null;
  };

  let inserted = 0;
  for (const sector of layout.sectors) {
    const ticketTypeId = findId(sector.name);
    if (!ticketTypeId) continue;
    for (const row of sector.rows ?? []) {
      for (const seat of row.seats ?? []) {
        const r = await client.query(
          `INSERT INTO catalog.event_seats
             (event_id, ticket_type_id, sector, row, seat_number,
              x_coord, y_coord, status, accessibility)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'available', false)
           ON CONFLICT (event_id, event_day_id, sector, row, seat_number) DO NOTHING`,
          [eventId, ticketTypeId, sector.name, row.label, seat.num, seat.x ?? null, seat.y ?? null],
        );
        inserted += r.rowCount ?? 0;
      }
    }
  }
  return inserted;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Event
    await client.query(
      `INSERT INTO catalog.events
         (id, organizer_id, promoter_id, venue_id, title, description, category,
          date_start, status, sale_start_at, event_type, currency, timezone, queue_enabled)
       VALUES ($1, $2, $2, $3, $4, $5, 'theatre',
               $6, 'published', now(), 'theatre', 'CZK', 'Europe/Prague', false)
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title,
             description = EXCLUDED.description,
             date_start = EXCLUDED.date_start,
             status = 'published',
             venue_id = EXCLUDED.venue_id,
             promoter_id = EXCLUDED.promoter_id,
             organizer_id = EXCLUDED.organizer_id`,
      [
        EVENT_ID, PROMOTER_ID, VENUE_ID,
        'Eddie & Vanessa — premiéra',
        'Hořkosladká komedie ve dvou jednáních. Autorská hra Divadla Verze v režii Jakuba Špalka. Premiéra v Hlavním sále.',
        eventDate.toISOString(),
      ],
    );

    // Ticket type
    await client.query(
      `INSERT INTO catalog.ticket_types
         (id, event_id, name, kind, base_price, total_qty, remaining_qty,
          zone, is_seated, visibility, attendance_type)
       VALUES ($1, $2, 'Plné vstupné', 'seated', 39000, 117, 117,
               'HLEDIŠTĚ', true, 'public', 'physical')
       ON CONFLICT (id) DO UPDATE
         SET base_price = EXCLUDED.base_price,
             total_qty = EXCLUDED.total_qty,
             zone = EXCLUDED.zone,
             is_seated = EXCLUDED.is_seated`,
      [TICKET_TYPE_ID, EVENT_ID],
    );

    // Vymaž starší seats (re-seed čistě)
    await client.query(`DELETE FROM catalog.event_seats WHERE event_id = $1`, [EVENT_ID]);
    const seats = await copyLayoutToSeats(client, EVENT_ID);

    // Sync remaining_qty s počtem skutečných seats
    await client.query(
      `UPDATE catalog.ticket_types
         SET total_qty = $2, remaining_qty = $2
       WHERE id = $1`,
      [TICKET_TYPE_ID, seats],
    );

    await client.query('COMMIT');
    console.log(`✓ Event "Eddie & Vanessa — premiéra" vytvořen`);
    console.log(`  ID: ${EVENT_ID}`);
    console.log(`  Datum: ${eventDate.toLocaleString('cs-CZ')}`);
    console.log(`  Cena: 390 Kč`);
    console.log(`  Seats vyrobeno: ${seats}`);
    console.log(`\n→ Buyer: http://localhost:3010/cs/events/${EVENT_ID}`);
    console.log(`→ Admin promotér: http://localhost:3010/cs/admin (login verze@divadlovceletne.cz / Demo2026!)`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
