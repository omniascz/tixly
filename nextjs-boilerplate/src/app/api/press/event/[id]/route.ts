import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: eventId } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(eventId)) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  }

  const r = await db().query<{
    id: string;
    name: string;
    date_start: string;
    venue_name: string | null;
    status: string;
    press_seats_max: number;
    press_deadline: string | null;
  }>(
    `SELECT e.id, e.name, e.date_start, v.name AS venue_name,
            e.status, e.press_seats_max, e.press_deadline
     FROM catalog.events e
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     WHERE e.id = $1`,
    [eventId],
  );

  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json({ event: r.rows[0] });
}
