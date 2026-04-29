/**
 * Most chart → event_seats v aplikačním kódu.
 *
 * TS port `pg_temp.copy_layout_to_event_seats` z `scripts/seed-rich-demo-phase3-seats.sql`.
 * Bez tohohle volání po vytvoření eventu zůstanou `event_seats` prázdné a
 * buyer SeatPicker zobrazí jen kostru sálu bez kliknutelných sedadel.
 *
 * Mapuje sektor v layoutu na ticket_type přes `zone`:
 *   1. exact match: `ticket_types.zone = sector.name`
 *   2. prefix match: `sector.name` začíná na `ticket_types.zone` (nejdelší vyhrává)
 *
 * Sektory bez matching ticket_type přeskočíme (nejde o error — promotér může
 * mít event s mixovaným standing+seated, kde jen některé sektory mají typ).
 */
import type { PoolClient } from 'pg';

interface LayoutSeat {
  num: string;
  x?: number;
  y?: number;
  acc?: boolean;
}
interface LayoutRow {
  label: string;
  seats: LayoutSeat[];
}
interface LayoutSector {
  name: string;
  rows: LayoutRow[];
}
interface Layout {
  sectors: LayoutSector[];
}

interface TicketTypeForMapping {
  id: string;
  zone: string | null;
}

interface CopyResult {
  insertedSeats: number;
  matchedSectors: number;
  skippedSectors: string[];
}

export async function copyLayoutToEventSeats(
  client: PoolClient,
  eventId: string,
): Promise<CopyResult> {
  const venueRes = await client.query<{ venue_id: string | null }>(
    `SELECT venue_id FROM catalog.events WHERE id = $1`,
    [eventId],
  );
  const venueId = venueRes.rows[0]?.venue_id;
  if (!venueId) return { insertedSeats: 0, matchedSectors: 0, skippedSectors: [] };

  const layoutRes = await client.query<{ layout: Layout }>(
    `SELECT layout FROM catalog.venue_seating_charts
     WHERE venue_id = $1 AND active = true
     ORDER BY created_at DESC LIMIT 1`,
    [venueId],
  );
  const layout = layoutRes.rows[0]?.layout;
  if (!layout || !Array.isArray(layout.sectors)) {
    // Sál bez seating chart → nic ke kopírování (standing event je legitimní).
    return { insertedSeats: 0, matchedSectors: 0, skippedSectors: [] };
  }

  const ttRes = await client.query<TicketTypeForMapping>(
    `SELECT id, zone FROM catalog.ticket_types WHERE event_id = $1 AND zone IS NOT NULL`,
    [eventId],
  );
  const ticketTypes = ttRes.rows;

  function findTicketTypeId(sectorName: string): string | null {
    const exact = ticketTypes.find((t) => t.zone === sectorName);
    if (exact) return exact.id;
    const prefixCandidates = ticketTypes
      .filter((t) => t.zone && sectorName.startsWith(t.zone))
      .sort((a, b) => (b.zone ?? '').length - (a.zone ?? '').length);
    return prefixCandidates[0]?.id ?? null;
  }

  let insertedSeats = 0;
  let matchedSectors = 0;
  const skippedSectors: string[] = [];

  for (const sector of layout.sectors) {
    const ticketTypeId = findTicketTypeId(sector.name);
    if (!ticketTypeId) {
      skippedSectors.push(sector.name);
      continue;
    }
    matchedSectors += 1;
    for (const row of sector.rows ?? []) {
      for (const seat of row.seats ?? []) {
        const r = await client.query(
          `INSERT INTO catalog.event_seats
             (event_id, ticket_type_id, sector, row, seat_number,
              x_coord, y_coord, status, accessibility)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'available', $8)
           ON CONFLICT (event_id, event_day_id, sector, row, seat_number) DO NOTHING`,
          [
            eventId,
            ticketTypeId,
            sector.name,
            row.label,
            seat.num,
            seat.x ?? null,
            seat.y ?? null,
            seat.acc === true,
          ],
        );
        insertedSeats += r.rowCount ?? 0;
      }
    }
  }

  return { insertedSeats, matchedSectors, skippedSectors };
}
