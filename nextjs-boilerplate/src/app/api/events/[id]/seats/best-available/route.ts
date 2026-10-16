/**
 * POST /api/events/[id]/seats/best-available
 * Public — vrátí nejlepší volná sedadla pro daný počet a typ vstupenky.
 *
 * Výběr sám nic nerezervuje. Volající dostane seat IDs a pošle je do
 * `/api/events/[id]/seats/hold` úplně stejně, jako by je vyklikal z plánku.
 * Díky tomu můžou „nejlepší dostupná" nabídnout i embed widget, mobilní
 * appka a pokladna, které vlastní plánek nekreslí.
 *
 * Body: { count: 1-20, ticketTypeId?: uuid, eventDayId?: uuid, includeAccessible?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/rls-pool';
import {
  pickBestAvailable,
  type BestLayout,
  type BestSeat,
} from '@/lib/seating/best-available';

const MAX_SEATS = 20;

const bodySchema = z.object({
  count: z.number().int().min(1).max(MAX_SEATS),
  ticketTypeId: z.string().uuid().nullable().optional(),
  eventDayId: z.string().uuid().nullable().optional(),
  includeAccessible: z.boolean().optional(),
});

// CORS preflight pro cross-origin embed picker — hlavičky doplní next.config.
export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  const raw: unknown = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const ev = await db().query<{ venue_id: string | null }>(
    `SELECT venue_id FROM catalog.events WHERE id = $1 AND status = 'published'`,
    [params.id],
  );
  if (ev.rows.length === 0 || !ev.rows[0].venue_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const layoutRes = await db().query<{ layout: BestLayout }>(
    `SELECT layout FROM catalog.venue_seating_charts
     WHERE venue_id = $1 AND active = true
     ORDER BY created_at DESC LIMIT 1`,
    [ev.rows[0].venue_id],
  );
  if (layoutRes.rows.length === 0) {
    return NextResponse.json({ error: 'NO_LAYOUT' }, { status: 404 });
  }

  const args: unknown[] = [params.id];
  let dayClause = `AND event_day_id IS NULL`;
  if (parsed.data.eventDayId) {
    args.push(parsed.data.eventDayId);
    dayClause = `AND (event_day_id = $2 OR event_day_id IS NULL)`;
  }

  // Expirovaný hold, který cron ještě nestačil uklidit, je fakticky volný —
  // stejné pravidlo jako v GET /seats, ať picker i tenhle výběr vidí totéž.
  const seatsRes = await db().query<{
    id: string;
    sector: string;
    row: string;
    seat_number: string;
    status: string;
    accessibility: boolean;
    ticket_type_id: string | null;
  }>(
    `SELECT es.id, es.sector, es.row, es.seat_number,
            CASE
              WHEN es.status = 'held' AND es.hold_until <= NOW() THEN 'available'
              ELSE es.status
            END AS status,
            es.accessibility, es.ticket_type_id
     FROM catalog.event_seats es
     WHERE es.event_id = $1 ${dayClause}`,
    args,
  );

  const seats: BestSeat[] = seatsRes.rows.map((s) => ({
    id: s.id,
    sector: s.sector,
    row: s.row,
    num: s.seat_number,
    status: s.status,
    ttId: s.ticket_type_id,
    acc: s.accessibility,
  }));

  const result = pickBestAvailable(layoutRes.rows[0].layout, seats, {
    count: parsed.data.count,
    ticketTypeId: parsed.data.ticketTypeId ?? null,
    includeAccessible: parsed.data.includeAccessible === true,
    maxCount: MAX_SEATS,
  });

  const byId = new Map(seats.map((s) => [s.id, s]));

  return NextResponse.json({
    seatIds: result.seatIds,
    seats: result.seatIds.map((id) => {
      const s = byId.get(id);
      return {
        id,
        sector: s?.sector ?? null,
        row: s?.row ?? null,
        num: s?.num ?? null,
        ttId: s?.ttId ?? null,
      };
    }),
    contiguous: result.contiguous,
    found: result.found,
    requested: parsed.data.count,
    reason: result.reason,
  });
}
