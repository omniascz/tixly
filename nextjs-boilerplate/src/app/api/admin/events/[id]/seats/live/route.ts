/**
 * GET /api/admin/events/[id]/seats/live
 *
 * Vrátí všechna sedadla s aktuálním statusem + souřadnicemi pro admin vizualizaci.
 * Také vrátí viewBox ze seating chartu pro správné měřítko SVG.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

interface SeatRow {
  id: string;
  sector: string;
  row: string;
  seat_number: string;
  x_coord: number;
  y_coord: number;
  status: string;
  hold_until: string | null;
  ticket_type_name: string | null;
  accessibility: boolean;
}

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }

    // Ownership check + venue_id
    const ev = await db().query<{ venue_id: string | null }>(
      `SELECT venue_id FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
      [params.id, promoter.promoterId],
    );
    if (ev.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const [seats, chart] = await Promise.all([
      db().query<SeatRow>(
        `SELECT
           es.id,
           es.sector,
           es.row,
           es.seat_number,
           es.x_coord,
           es.y_coord,
           CASE
             WHEN es.status = 'held' AND es.hold_until <= NOW() THEN 'available'
             ELSE es.status
           END AS status,
           es.hold_until::text,
           tt.name AS ticket_type_name,
           COALESCE(es.accessibility, false) AS accessibility
         FROM catalog.event_seats es
         LEFT JOIN catalog.ticket_types tt ON tt.id = es.ticket_type_id
         WHERE es.event_id = $1
         ORDER BY es.sector, es.row, es.seat_number`,
        [params.id],
      ),
      ev.rows[0].venue_id
        ? db().query<{ view_box: string | null }>(
            `SELECT layout->>'viewBox' AS view_box
             FROM catalog.venue_seating_charts
             WHERE venue_id = $1 AND active = true
             ORDER BY created_at DESC LIMIT 1`,
            [ev.rows[0].venue_id],
          )
        : Promise.resolve({ rows: [] as { view_box: string | null }[] }),
    ]);

    // Summary stats
    const summary = { available: 0, held: 0, sold: 0, blocked: 0 };
    for (const s of seats.rows) {
      const k = s.status as keyof typeof summary;
      if (k in summary) summary[k]++;
    }

    return NextResponse.json({
      viewBox: chart.rows[0]?.view_box ?? '0 0 1200 900',
      seats: seats.rows.map((s) => ({
        id: s.id,
        sector: s.sector,
        row: s.row,
        seatNumber: s.seat_number,
        x: s.x_coord,
        y: s.y_coord,
        status: s.status,
        holdUntil: s.hold_until,
        ticketTypeName: s.ticket_type_name,
        accessibility: s.accessibility,
      })),
      summary,
      fetchedAt: new Date().toISOString(),
    });
  });
}
