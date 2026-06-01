/**
 * GET /api/admin/pos/events — published akce promotera + ticket types
 *
 * UI pokladny (/admin/pos) potřebuje pro každou akci hned znát:
 *   - id, title, dateStart
 *   - ticketTypes: id, name, basePrice, remainingQty, isSeated
 *
 * Filtrujeme jen nadcházející published akce (sale_end_at je v budoucnu).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';


interface EventRow {
  id: string;
  title: string;
  date_start: string;
}

interface TicketTypeRow {
  id: string;
  event_id: string;
  name: string;
  base_price: number;
  remaining_qty: number;
  is_seated: boolean;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  // Načti akce + ticket types per akce v 1 query (less round-trips)
  const events = await db().query<EventRow>(
    `SELECT id, title, date_start
     FROM catalog.events
     WHERE promoter_id = $1
       AND status = 'published'
       AND date_start > now() - interval '12 hours'
     ORDER BY date_start
     LIMIT 100`,
    [promoter.promoterId],
  );

  if (events.rows.length === 0) {
    return NextResponse.json({ events: [] });
  }

  const eventIds = events.rows.map((r) => r.id);
  const tts = await db().query<TicketTypeRow>(
    `SELECT id, event_id, name, base_price, remaining_qty, is_seated
     FROM catalog.ticket_types
     WHERE event_id = ANY($1::uuid[])
       AND visibility = 'public'
     ORDER BY base_price`,
    [eventIds],
  );

  const ttByEvent = new Map<string, TicketTypeRow[]>();
  for (const t of tts.rows) {
    const list = ttByEvent.get(t.event_id) ?? [];
    list.push(t);
    ttByEvent.set(t.event_id, list);
  }

  return NextResponse.json({
    events: events.rows.map((ev) => ({
      id: ev.id,
      title: ev.title,
      dateStart: ev.date_start,
      ticketTypes: (ttByEvent.get(ev.id) ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        basePrice: t.base_price,
        remainingQty: t.remaining_qty,
        isSeated: t.is_seated,
      })),
    })),
  });

  });
}
