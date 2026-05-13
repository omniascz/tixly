// Vyrobí venue 205 (Sportovní stadion FC Olomouc, 12 000) + chart 304 +
// event 410 (FC Olomouc vs SK Hradec Králové) + 4 ticket_types se zone
// matchem (SEVER/JIH/VYCHOD/ZAPAD) + regenerace event_seats z layoutu.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromApp = createRequire(join(__dirname, '..', 'nextjs-boilerplate', 'noop.js'));
const pg = requireFromApp('pg');

const VENUE_ID = '00000000-0000-4000-a000-000000000205';
const CHART_ID = '00000000-0000-4000-a000-000000000304';
const EVENT_ID = '00000000-0000-4000-a000-000000000410';
const PROMOTER_ID = '00000000-0000-4000-a000-000000000113'; // multiarena (arena@multiprod.cz)
const TT_PREFIX = '00000000-0000-4000-a000-00000000060'; // unused range 600..603

const TICKET_TYPES = [
  { id: TT_PREFIX + '0', name: 'VIP — Východní tribuna', zone: 'VYCHOD', priceCzk: 890 },
  { id: TT_PREFIX + '1', name: 'Standard — Západní tribuna', zone: 'ZAPAD', priceCzk: 390 },
  { id: TT_PREFIX + '2', name: 'Brankoviště — Severní tribuna', zone: 'SEVER', priceCzk: 290 },
  { id: TT_PREFIX + '3', name: 'Brankoviště — Jižní tribuna', zone: 'JIH', priceCzk: 290 },
];

const BATCH_SIZE = 2000;
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
});

async function main() {
  const layoutJson = readFileSync(join(__dirname, 'layouts', 'stadion-12k.json'), 'utf8');
  const layout = JSON.parse(layoutJson);
  const totalSeats = layout.sectors.reduce(
    (sum, s) => sum + s.rows.reduce((a, r) => a + r.seats.length, 0),
    0,
  );

  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    // 1) Venue
    await c.query(
      `INSERT INTO catalog.venues
         (id, name, address, city, country, capacity, venue_type,
          promoter_id, status, gps_lat, gps_lng, description)
       VALUES ($1, $2, $3, $4, 'CZ', $5, 'stadium', $6, 'published',
               49.5938, 17.2509, $7)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, capacity = EXCLUDED.capacity,
             description = EXCLUDED.description`,
      [
        VENUE_ID,
        'Sportovní stadion FC Olomouc',
        'Legionářská 12, Olomouc',
        'Olomouc',
        totalSeats,
        PROMOTER_ID,
        'Středně velký fotbalový stadion 12 000. 4 tribuny: Sever (brankoviště hosté), Jih (kotel domácích), Východ (hlavní s VIP), Západ.',
      ],
    );
    console.log('[venue] 205: Sportovní stadion FC Olomouc');

    // 2) Chart
    await c.query(
      `INSERT INTO catalog.venue_seating_charts
         (id, venue_id, name, layout, total_seats, active, source, notes)
       VALUES ($1, $2, $3, $4::jsonb, $5, true, 'seed', 'Doosan Aréna Plzeň-style 12 000')
       ON CONFLICT (id) DO UPDATE
         SET layout = EXCLUDED.layout, total_seats = EXCLUDED.total_seats,
             name = EXCLUDED.name, notes = EXCLUDED.notes`,
      [CHART_ID, VENUE_ID, 'Stadion Olomouc — 4 tribuny (12 000)', layoutJson, totalSeats],
    );
    console.log('[chart] 304: ' + totalSeats + ' sedadel, ' + layout.sectors.length + ' sektorů');

    // 3) Event
    const dateStart = '2026-09-15 19:00:00+02';
    await c.query(
      `INSERT INTO catalog.events
         (id, organizer_id, venue_id, title, description, category,
          date_start, date_end, status, sale_start_at, sale_end_at,
          resale_allowed, currency, timezone, promoter_id, event_type,
          max_tickets_per_order, template)
       VALUES ($1, $2, $3, $4, $5, 'sport',
               $6, $6::timestamptz + INTERVAL '2 hours',
               'published',
               NOW(), $6::timestamptz - INTERVAL '1 hour',
               false, 'CZK', 'Europe/Prague', $2, 'sport',
               4, 'single_event')
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, description = EXCLUDED.description,
             status = EXCLUDED.status,
             venue_id = EXCLUDED.venue_id,
             organizer_id = EXCLUDED.organizer_id,
             promoter_id = EXCLUDED.promoter_id,
             category = EXCLUDED.category,
             date_start = EXCLUDED.date_start,
             date_end = EXCLUDED.date_end`,
      [
        EVENT_ID, PROMOTER_ID, VENUE_ID,
        'FC Olomouc vs. SK Hradec Králové',
        'Ligový zápas Fortuna ligy. Domácí FC Olomouc proti SK Hradec Králové.',
        dateStart,
      ],
    );
    console.log('[event] 410: FC Olomouc vs. SK Hradec Králové');

    // 4) Vyčisti staré ticket_types pro event 410 (z předchozích seedů — žádné
    // event_seats na ně nezávisí) a smaž zbytky 540/541 z event 406, které se
    // tam připletly při dřívějším failed runu.
    await c.query(`DELETE FROM catalog.ticket_types WHERE event_id = $1`, [EVENT_ID]);
    await c.query(
      `DELETE FROM catalog.ticket_types
       WHERE id::text IN (
         '00000000-0000-4000-a000-000000000540',
         '00000000-0000-4000-a000-000000000541'
       )`,
    );
    console.log('[cleanup] removed old ticket_types from event 410 + stale 540/541');

    // 5) Ticket types
    for (const tt of TICKET_TYPES) {
      // Spočítat kapacitu zone z layoutu
      const zoneSeats = layout.sectors
        .filter((s) => s.name.startsWith(tt.zone))
        .reduce((sum, s) => sum + s.rows.reduce((a, r) => a + r.seats.length, 0), 0);
      await c.query(
        `INSERT INTO catalog.ticket_types
           (id, event_id, name, kind, base_price, total_qty, remaining_qty,
            max_per_user, zone, attendance_type, transferable, visibility,
            is_seated, resale_allowed)
         VALUES ($1, $2, $3, 'seated', $4, $5, $5, 4, $6,
                 'physical', true, 'public', true, false)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name, base_price = EXCLUDED.base_price,
               total_qty = EXCLUDED.total_qty, remaining_qty = EXCLUDED.remaining_qty,
               zone = EXCLUDED.zone`,
        [tt.id, EVENT_ID, tt.name, tt.priceCzk * 100, zoneSeats, tt.zone],
      );
      console.log(`  ticket_type: ${tt.name} (zone=${tt.zone}, ${zoneSeats} seats, ${tt.priceCzk} Kč)`);
    }

    // 6) Smaž staré event_seats (pokud byly) a regeneruj
    await c.query('DELETE FROM catalog.event_seats WHERE event_id = $1', [EVENT_ID]);

    const ttRes = await c.query(
      `SELECT id, zone FROM catalog.ticket_types WHERE event_id = $1`,
      [EVENT_ID],
    );
    const ttRows = ttRes.rows;
    function findTtId(sectorName) {
      const exact = ttRows.find((t) => t.zone === sectorName);
      if (exact) return exact.id;
      const prefix = ttRows
        .filter((t) => t.zone && sectorName.startsWith(t.zone))
        .sort((a, b) => (b.zone ?? '').length - (a.zone ?? '').length);
      return prefix[0]?.id ?? null;
    }

    const allRows = [];
    for (const sector of layout.sectors) {
      const ttId = findTtId(sector.name);
      if (!ttId) continue;
      for (const row of sector.rows) {
        for (const seat of row.seats) {
          allRows.push([
            EVENT_ID, ttId, sector.name, row.label, seat.num,
            seat.x ?? null, seat.y ?? null, seat.acc === true,
          ]);
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
      const r = await c.query(
        `INSERT INTO catalog.event_seats
           (event_id, ticket_type_id, sector, row, seat_number,
            x_coord, y_coord, status, accessibility)
         VALUES ${values.join(',')}
         ON CONFLICT (event_id, event_day_id, sector, row, seat_number) DO NOTHING`,
        params,
      );
      inserted += r.rowCount ?? 0;
    }
    console.log(`[event_seats] inserted ${inserted} seats`);

    await c.query('COMMIT');
    console.log('\n✓ Hotovo. URL: http://localhost:3010/cs/events/' + EVENT_ID + '/seats');
  } catch (err) {
    await c.query('ROLLBACK');
    console.error('FAIL:', err);
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
}

main();
