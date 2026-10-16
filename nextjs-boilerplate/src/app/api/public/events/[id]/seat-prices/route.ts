/**
 * GET /api/public/events/[id]/seat-prices — výběr míst a kategorií pro kupce (kolo 8 / krok 4):
 * místa (stav, typ místa, zóna), zóny s barvami, slevové kategorie a jejich ceny v zónách.
 * Ceny jsou jen informativní — checkout (/api/checkout/seats) je počítá znovu na serveru.
 * Bez přihlášení; čtení řídí veřejné politiky (publikovaný termín).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { priceTable } from '@/lib/theatre/categories';
import { reservationDeadline, type ReservationSettings } from '@/lib/theatre/reservations';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
  const ev = await db().query<ReservationSettings & { id: string; currency: string }>(
    `SELECT id, currency, date_start, reservations_enabled, reservation_days, reservation_cutoff_hours
       FROM catalog.events WHERE id = $1 AND status = 'published'`, [params.id],
  );
  if (!ev.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  // kolo 8 / krok 5: „Rezervovat, zaplatím na pokladně" — jen když termín rezervace přijímá; lhůtu počítá server
  const e = ev.rows[0];
  const reservationUntil = e.reservations_enabled
    ? reservationDeadline(new Date(), new Date(e.date_start), e.reservation_days, e.reservation_cutoff_hours)
    : null;
  const table = await priceTable(db(), params.id);
  const seats = await db().query(
    `SELECT id, sector, row, seat_number AS "seatNumber", x_coord AS x, y_coord AS y, ticket_type_id AS "ticketTypeId",
            seat_type AS "seatType", seat_note AS "seatNote",
            CASE WHEN status = 'available' THEN 'available' ELSE 'unavailable' END AS status
       FROM catalog.event_seats WHERE event_id = $1 ORDER BY sector, row, seat_number`,
    [params.id],
  );
  const zoneColor = await db().query<{ name: string; color: string }>(
    `SELECT z->>'name' AS name, z->>'color' AS color
       FROM catalog.events e JOIN catalog.venue_seating_charts c ON c.id = e.seat_chart_id,
            jsonb_array_elements(COALESCE(c.layout->'zones', '[]'::jsonb)) z
      WHERE e.id = $1`,
    [params.id],
  );
  const colors = new Map(zoneColor.rows.map((z) => [z.name, z.color]));
  return NextResponse.json({
    currency: e.currency,
    reservation: reservationUntil ? { available: true, until: reservationUntil.toISOString() } : { available: false, until: null },
    zones: table.zones.map((z) => ({ id: z.id, name: z.name, fullPriceMinor: z.base_price, color: colors.get(z.name) ?? null })),
    categories: table.categories.map((c) => ({
      id: c.id, code: c.code, name: c.name, kind: c.kind, requiresProof: c.requires_proof, proofLabel: c.proof_label,
    })),
    prices: table.prices,
    seats: seats.rows,
  });
}
