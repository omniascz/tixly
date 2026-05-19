/**
 * GET  /api/admin/events/[id]/seats — list seats + summary stats
 * POST /api/admin/events/[id]/seats — generate seats z venue layoutu + price tier mapping
 *
 * POST body:
 *   {
 *     eventDayId?: uuid (volitelné — pro multi-day, jinak generuje pro celé event)
 *     sectorMappings: [
 *       { sectorName: "Lateral 1", ticketTypeId: "uuid" },
 *       { sectorName: "Tribuna", ticketTypeId: "uuid" }
 *     ]
 *   }
 *
 * Idempotence: pokud už event má seats, vrátí 409 — admin musí explicitně volat DELETE první.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const postSchema = z.object({
  eventDayId: z.string().uuid().nullable().optional(),
  sectorMappings: z
    .array(
      z.object({
        sectorName: z.string().min(1).max(100),
        ticketTypeId: z.string().uuid(),
      }),
    )
    .min(1)
    .max(50),
});

interface SeatLayoutRow {
  num: string;
  x: number;
  y: number;
  accessibility?: boolean;
}
interface SectorLayout {
  name: string;
  color?: string;
  rows: { label: string; seats: SeatLayoutRow[] }[];
}
interface VenueLayout {
  viewBox: string;
  sectors: SectorLayout[];
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const owns = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (owns.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const stats = await db().query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count FROM catalog.event_seats
     WHERE event_id = $1 GROUP BY status`,
    [params.id],
  );
  const summary = Object.fromEntries(stats.rows.map((s) => [s.status, Number(s.count)]));

  return NextResponse.json({
    summary: {
      available: summary.available ?? 0,
      held: summary.held ?? 0,
      sold: summary.sold ?? 0,
      blocked: summary.blocked ?? 0,
      total:
        (summary.available ?? 0) +
        (summary.held ?? 0) +
        (summary.sold ?? 0) +
        (summary.blocked ?? 0),
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Ownership + venue
    const ev = await client.query<{ venue_id: string | null }>(
      `SELECT venue_id FROM catalog.events
       WHERE id = $1 AND promoter_id = $2 FOR UPDATE`,
      [params.id, promoter.promoterId],
    );
    if (ev.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!ev.rows[0].venue_id) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'EVENT_HAS_NO_VENUE', message: 'Akce nemá přiřazený sál.' },
        { status: 422 },
      );
    }

    // Get layout
    const lr = await client.query<{ layout: VenueLayout; total_seats: number }>(
      `SELECT layout, total_seats FROM catalog.venue_seating_charts
       WHERE venue_id = $1 AND active = true
       ORDER BY created_at DESC LIMIT 1`,
      [ev.rows[0].venue_id],
    );
    if (lr.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'NO_VENUE_LAYOUT', message: 'Sál nemá nahraný seating chart.' },
        { status: 422 },
      );
    }
    const layout = lr.rows[0].layout;

    // Idempotence — pokud už existují seats pro tento event/day, refuse
    const existing = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM catalog.event_seats
       WHERE event_id = $1
         AND ($2::uuid IS NULL OR event_day_id = $2 OR event_day_id IS NULL)`,
      [params.id, parsed.data.eventDayId ?? null],
    );
    if (Number(existing.rows[0]?.count ?? 0) > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'SEATS_ALREADY_EXIST', message: 'Sedadla už byla vygenerována. DELETE first.' },
        { status: 409 },
      );
    }

    // Validate ticket types existují a patří k eventu, mark them as is_seated
    const ttIds = parsed.data.sectorMappings.map((m) => m.ticketTypeId);
    const ttRes = await client.query<{ id: string }>(
      `SELECT id FROM catalog.ticket_types
       WHERE event_id = $1 AND id = ANY($2::uuid[])`,
      [params.id, ttIds],
    );
    if (ttRes.rows.length !== new Set(ttIds).size) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'TICKET_TYPE_NOT_IN_EVENT' },
        { status: 422 },
      );
    }
    await client.query(
      `UPDATE catalog.ticket_types SET is_seated = true
       WHERE event_id = $1 AND id = ANY($2::uuid[])`,
      [params.id, ttIds],
    );

    // Build mapping
    const mapping = new Map<string, string>(
      parsed.data.sectorMappings.map((m) => [m.sectorName, m.ticketTypeId]),
    );

    // Bulk insert seats — UNNEST scales to 100k+ seats in one round trip per sector.
    let inserted = 0;
    for (const sector of layout.sectors) {
      const ttId = mapping.get(sector.name);
      if (!ttId) continue; // skip sectors not mapped

      const rowLabels: string[] = [];
      const seatNums: string[] = [];
      const xs: number[] = [];
      const ys: number[] = [];
      const accs: boolean[] = [];
      for (const row of sector.rows) {
        for (const seat of row.seats) {
          rowLabels.push(row.label);
          seatNums.push(seat.num);
          xs.push(seat.x);
          ys.push(seat.y);
          accs.push(seat.accessibility ?? false);
        }
      }
      if (rowLabels.length === 0) continue;

      await client.query(
        `INSERT INTO catalog.event_seats
           (event_id, event_day_id, ticket_type_id, sector, row, seat_number, x_coord, y_coord, accessibility)
         SELECT $1, $2, $3, $4, t.row_label, t.seat_num, t.x, t.y, t.acc
           FROM UNNEST($5::text[], $6::text[], $7::numeric[], $8::numeric[], $9::boolean[])
             AS t(row_label, seat_num, x, y, acc)`,
        [
          params.id, parsed.data.eventDayId ?? null, ttId, sector.name,
          rowLabels, seatNums, xs, ys, accs,
        ],
      );
      inserted += rowLabels.length;
    }

    // Update remaining_qty per ticket type to match generated seats
    await client.query(
      `UPDATE catalog.ticket_types tt
       SET remaining_qty = (
         SELECT COUNT(*) FROM catalog.event_seats es
         WHERE es.ticket_type_id = tt.id AND es.event_id = $1 AND es.status = 'available'
       ),
       total_qty = (
         SELECT COUNT(*) FROM catalog.event_seats es
         WHERE es.ticket_type_id = tt.id AND es.event_id = $1
       )
       WHERE tt.event_id = $1 AND tt.id = ANY($2::uuid[])`,
      [params.id, ttIds],
    );

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, inserted });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[event seats generate]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owns = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (owns.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Refuse if any seat is sold
  const sold = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.event_seats
     WHERE event_id = $1 AND status = 'sold'`,
    [params.id],
  );
  if (Number(sold.rows[0]?.count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'SOLD_SEATS_EXIST', message: 'Nelze smazat — některá sedadla jsou prodaná.' },
      { status: 409 },
    );
  }
  const r = await db().query(`DELETE FROM catalog.event_seats WHERE event_id = $1`, [params.id]);
  return NextResponse.json({ ok: true, deleted: r.rowCount });
}
