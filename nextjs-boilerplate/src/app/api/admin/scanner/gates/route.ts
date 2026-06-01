/**
 * GET /api/admin/scanner/gates
 *
 * Returns promoter's published events with their days + zones,
 * pro scanner staff UI (gate / day / zone selector).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';


interface EventRow {
  id: string;
  title: string;
  date_start: string;
}
interface DayRow {
  id: string;
  event_id: string;
  label: string | null;
  starts_at: string;
  day_index: number;
}
interface ZoneRow {
  id: string;
  event_id: string;
  name: string;
  zone_type: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const events = await db().query<EventRow>(
    `SELECT id, title, date_start
     FROM catalog.events
     WHERE promoter_id = $1
       AND status IN ('published', 'pending_review')
       AND date_start > NOW() - INTERVAL '7 days'
     ORDER BY date_start ASC
     LIMIT 50`,
    [promoter.promoterId],
  );
  const eventIds = events.rows.map((e) => e.id);

  const days =
    eventIds.length === 0
      ? { rows: [] as DayRow[] }
      : await db().query<DayRow>(
          `SELECT id, event_id, label, starts_at, day_index
           FROM catalog.event_days
           WHERE event_id = ANY($1::uuid[])
           ORDER BY event_id, day_index`,
          [eventIds],
        );
  const zones =
    eventIds.length === 0
      ? { rows: [] as ZoneRow[] }
      : await db().query<ZoneRow>(
          `SELECT id, event_id, name, zone_type
           FROM catalog.event_zones
           WHERE event_id = ANY($1::uuid[])
           ORDER BY event_id, display_order`,
          [eventIds],
        );

  const out = events.rows.map((e) => ({
    id: e.id,
    title: e.title,
    dateStart: e.date_start,
    days: days.rows
      .filter((d) => d.event_id === e.id)
      .map((d) => ({
        id: d.id,
        label: d.label,
        startsAt: d.starts_at,
        dayIndex: d.day_index,
      })),
    zones: zones.rows
      .filter((z) => z.event_id === e.id)
      .map((z) => ({ id: z.id, name: z.name, zoneType: z.zone_type })),
  }));

  return NextResponse.json({ events: out });

  });
}
