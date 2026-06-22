/**
 * POST /api/internal/cron/forgemsg-sync-events
 *
 * Syncs upcoming events (+ unsold-seat counts) to ForgeMsg as `event_upsert`
 * outbox rows, so ForgeMsg's day-of journey + fill-the-house yield engines have
 * fresh data. One row per promoter's event. Auth: x-internal-token.
 */
import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { emitForgeMsg } from '@/lib/forgemsg/emit';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface EventRow {
  id: string;
  promoter_id: string | null;
  title: string;
  category: string | null;
  subcategory: string | null;
  date_start: string | null;
  currency: string | null;
  venue_name: string | null;
  venue_city: string | null;
  unsold: number;
  unsold_by_tier: Record<string, number> | null;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const token = req.headers.get('x-internal-token') ?? '';
    const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
    if (!expected || !safeEqual(token, expected)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const r = await db().query<EventRow>(
      `SELECT e.id, e.promoter_id, e.title, e.category, e.subcategory,
              e.date_start, e.currency,
              v.name AS venue_name, v.city AS venue_city,
              COALESCE(SUM(tt.remaining_qty), 0)::int AS unsold,
              jsonb_object_agg(tt.name, tt.remaining_qty)
                FILTER (WHERE tt.id IS NOT NULL) AS unsold_by_tier
         FROM catalog.events e
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id
        WHERE e.date_start > NOW()
          AND e.date_start < NOW() + INTERVAL '30 days'
        GROUP BY e.id, v.name, v.city
        LIMIT 2000`,
    );

    let emitted = 0;
    for (const ev of r.rows) {
      await emitForgeMsg(
        {
          type: 'event_upsert',
          event: {
            externalId: ev.id,
            title: ev.title,
            category: ev.category ?? undefined,
            subcategory: ev.subcategory ?? undefined,
            venueName: ev.venue_name ?? undefined,
            venueCity: ev.venue_city ?? undefined,
            currency: ev.currency ?? 'CZK',
            url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/cs/events/${ev.id}`,
            startsAt: ev.date_start ?? undefined,
            // Decouple from Tixly's status enum: sellable iff seats remain.
            status: ev.unsold > 0 ? 'on_sale' : 'sold_out',
            unsoldSeats: ev.unsold,
            unsoldByTier: ev.unsold_by_tier ?? undefined,
          },
        },
        ev.promoter_id,
      );
      emitted++;
    }

    return NextResponse.json({ events: r.rows.length, emitted });
  });
}
