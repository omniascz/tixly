/**
 * Most chart → event_seats v aplikačním kódu.
 *
 * TS port `pg_temp.copy_layout_to_event_seats` z `scripts/seed-rich-demo-phase3-seats.sql`.
 * Bez tohohle volání po vytvoření eventu zůstanou `event_seats` prázdné a
 * buyer SeatPicker zobrazí jen kostru sálu bez kliknutelných sedadel.
 *
 * Mapuje místo na ticket_type přes `ticket_types.zone`:
 *   1. kolo 8: cenová zóna místa (seat.zone → layout.zones[].name) = ticket_types.zone (přesně),
 *   2. jinak sekce místa: exact match `ticket_types.zone = sector.name`, nebo prefix (nejdelší vyhrává).
 * Místa bez odpovídajícího typu přeskočíme (smíšený stání + sedadla je legitimní).
 *
 * Kolo 8 (krok 2): přenáší typ místa (běžné / vozíčkář / doprovod / neprodejné / omezený výhled) a poznámku;
 * neprodejné místo je rovnou blokované. Dřív se četl neexistující `seat.acc` místo `seat.accessibility`
 * (příznak přístupnosti se ztrácel). Kopíruje se jen do termínu BEZ sedadel (ON CONFLICT nefungoval —
 * event_day_id je NULL, takže unikátní index duplicitu nezastavil) a zapíše se verze plánku
 * (events.seat_chart_id). Pozdější úprava plánku sálu termín nezmění; převzít znovu jde jen u neprodaného
 * termínu (refreshEventSeatsFromChart).
 */
import type { PoolClient } from 'pg';

interface LayoutSeat {
  num: string;
  x?: number;
  y?: number;
  accessibility?: boolean;
  type?: 'standard' | 'wheelchair' | 'companion' | 'unsellable' | 'restricted';
  note?: string;
  zone?: string;
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
  zones?: Array<{ id: string; name: string }>;
}

interface TicketTypeForMapping {
  id: string;
  zone: string | null;
}

interface CopyResult {
  insertedSeats: number;
  matchedSectors: number;
  skippedSectors: string[];
  chartId?: string | null;
}

type Q = Pick<PoolClient, 'query'>;

export async function copyLayoutToEventSeats(
  client: Q,
  eventId: string,
): Promise<CopyResult> {
  const venueRes = await client.query<{ venue_id: string | null }>(
    `SELECT venue_id FROM catalog.events WHERE id = $1`,
    [eventId],
  );
  const venueId = venueRes.rows[0]?.venue_id;
  if (!venueId) return { insertedSeats: 0, matchedSectors: 0, skippedSectors: [] };

  const existing = await client.query<{ n: number }>(`SELECT count(*)::int n FROM catalog.event_seats WHERE event_id = $1`, [eventId]);
  if (existing.rows[0].n > 0) return { insertedSeats: 0, matchedSectors: 0, skippedSectors: [] };

  const layoutRes = await client.query<{ id: string; layout: Layout }>(
    `SELECT id, layout FROM catalog.venue_seating_charts
     WHERE venue_id = $1 AND active = true
     ORDER BY created_at DESC LIMIT 1`,
    [venueId],
  );
  const layout = layoutRes.rows[0]?.layout;
  if (!layout || !Array.isArray(layout.sectors)) {
    // Sál bez seating chart → nic ke kopírování (standing event je legitimní).
    return { insertedSeats: 0, matchedSectors: 0, skippedSectors: [] };
  }
  const chartId = layoutRes.rows[0].id;

  const ttRes = await client.query<TicketTypeForMapping>(
    `SELECT id, zone FROM catalog.ticket_types WHERE event_id = $1 AND zone IS NOT NULL`,
    [eventId],
  );
  const ticketTypes = ttRes.rows;
  const zoneName = new Map((layout.zones ?? []).map((z) => [z.id, z.name]));

  // Normalizace pro robustní matching: trim + lowercase + NFC (sjednotí diakritiku).
  // Bez tohohle stačila drobná odchylka case (sektor "Přízemí" vs zone "PŘÍZEMÍ")
  // a seats se TIŠE nevytvořily → buyer prázdná mapa, žádná chyba (křehký šev).
  const norm = (s: string): string => s.trim().toLocaleLowerCase('cs').normalize('NFC');
  function findTicketTypeId(name: string, exactOnly = false): string | null {
    const target = norm(name);
    const exact = ticketTypes.find((t) => t.zone && norm(t.zone) === target);
    if (exact || exactOnly) return exact?.id ?? null;
    const prefixCandidates = ticketTypes
      .filter((t) => t.zone && target.startsWith(norm(t.zone)))
      .sort((a, b) => (b.zone ?? '').length - (a.zone ?? '').length);
    return prefixCandidates[0]?.id ?? null;
  }

  // Hromadný insert (300+ míst jedním dotazem místo dotazu na místo).
  const cols: unknown[][] = [[], [], [], [], [], [], [], [], [], [], [], []];
  let matchedSectors = 0;
  const skippedSectors: string[] = [];

  for (const sector of layout.sectors) {
    const sectorTt = findTicketTypeId(sector.name);
    let sectorMatched = false;
    for (const row of sector.rows ?? []) {
      for (const seat of row.seats ?? []) {
        const zName = seat.zone ? zoneName.get(seat.zone) ?? null : null;
        const ticketTypeId = (zName ? findTicketTypeId(zName, true) : null) ?? sectorTt;
        if (!ticketTypeId) continue;
        sectorMatched = true;
        const type = seat.type ?? (seat.accessibility ? 'wheelchair' : 'standard');
        const values = [
          ticketTypeId, sector.name, row.label, seat.num, seat.x ?? null, seat.y ?? null,
          type === 'unsellable' ? 'blocked' : 'available',
          type === 'wheelchair' || seat.accessibility === true,
          type, seat.note ?? null, zName, type === 'unsellable' ? 'Neprodejné místo' : null,
        ];
        values.forEach((v, i) => cols[i].push(v));
      }
    }
    if (sectorMatched) matchedSectors += 1;
    else skippedSectors.push(sector.name);
  }

  let insertedSeats = 0;
  if (cols[0].length > 0) {
    const r = await client.query(
      `INSERT INTO catalog.event_seats
         (event_id, ticket_type_id, sector, row, seat_number, x_coord, y_coord, status, accessibility,
          seat_type, seat_note, price_zone, hold_label, hold_kind)
       SELECT $1, t.tt, t.sector, t.row, t.num, t.x, t.y, t.status, t.acc, t.stype, t.note, t.zone, t.label,
              CASE WHEN t.status = 'blocked' THEN 'production' END
         FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::float8[], $7::float8[], $8::text[], $9::bool[],
                     $10::text[], $11::text[], $12::text[], $13::text[])
              AS t(tt, sector, row, num, x, y, status, acc, stype, note, zone, label)`,
      [eventId, ...cols],
    );
    insertedSeats = r.rowCount ?? 0;
  }
  await client.query(`UPDATE catalog.events SET seat_chart_id = $2 WHERE id = $1`, [eventId, chartId]);

  return { insertedSeats, matchedSectors, skippedSectors, chartId };
}

export class SeatRefreshError extends Error {
  constructor(public code: 'HAS_SALES', message: string) {
    super(message);
  }
}

/**
 * Znovu převezme plánek sálu do NEPRODANÉHO termínu: smaže sedadla a zkopíruje aktuální aktivní plánek.
 * Termín s prodaným, drženým nebo rezervovaným místem nebo s objednávkou se nezmění (HAS_SALES).
 */
export async function refreshEventSeatsFromChart(client: Q, eventId: string): Promise<CopyResult> {
  const busy = await client.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM catalog.event_seats WHERE event_id = $1
               AND (status IN ('sold', 'held') OR order_id IS NOT NULL OR ticket_id IS NOT NULL))
          + (SELECT count(*) FROM orders.orders WHERE event_id = $1 AND status NOT IN ('cancelled', 'expired')) AS n`,
    [eventId],
  );
  if (busy.rows[0].n > 0) {
    throw new SeatRefreshError('HAS_SALES', 'Termín už má prodaná, držená nebo rezervovaná místa — plánek nelze převzít znovu.');
  }
  await client.query(`DELETE FROM catalog.event_seats WHERE event_id = $1`, [eventId]);
  const r = await copyLayoutToEventSeats(client, eventId);
  await client.query(
    `UPDATE catalog.ticket_types tt SET total_qty = COALESCE(s.n, 0), remaining_qty = COALESCE(s.n, 0)
       FROM (SELECT t.id, (SELECT count(*)::int FROM catalog.event_seats es WHERE es.ticket_type_id = t.id AND es.status = 'available') n
               FROM catalog.ticket_types t WHERE t.event_id = $1 AND t.zone IS NOT NULL) s
      WHERE tt.id = s.id`,
    [eventId],
  );
  return r;
}
