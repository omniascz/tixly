/**
 * GET /api/events/[id]/entry-slots
 *
 * Public buyer endpoint — list dostupných slotů pro timed-entry event.
 * Query: ?date=YYYY-MM-DD (filtruj na konkrétní den), ?days=7 (range)
 *
 * Vrátí pouze status='open' a remaining > 0 a slot_start v budoucnosti.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';


export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
  }
  const date = req.nextUrl.searchParams.get('date');
  const days = Math.min(31, Math.max(1, Number(req.nextUrl.searchParams.get('days') ?? '7')));

  const args: unknown[] = [params.id];
  let dateClause = `AND slot_start > NOW() AND slot_start <= NOW() + ($2 || ' days')::interval`;
  args.push(String(days));

  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    args.splice(1, 1, date, date);
    dateClause = `AND slot_start >= ($2::date AT TIME ZONE 'Europe/Prague')
                  AND slot_start <  (($3::date + 1) AT TIME ZONE 'Europe/Prague')`;
  }

  const r = await db().query<{
    id: string;
    slot_start: string;
    slot_end: string;
    remaining: number;
    capacity: number;
  }>(
    `SELECT id, slot_start, slot_end, remaining, capacity
     FROM catalog.entry_slots
     WHERE event_id = $1 AND status = 'open' AND remaining > 0
       ${dateClause}
     ORDER BY slot_start ASC
     LIMIT 200`,
    args,
  );

  // Group by date (Europe/Prague TZ display)
  const byDate = new Map<string, typeof r.rows>();
  for (const slot of r.rows) {
    const localDate = new Date(slot.slot_start)
      .toLocaleString('sv-SE', { timeZone: 'Europe/Prague' })
      .slice(0, 10);
    const arr = byDate.get(localDate) ?? [];
    arr.push(slot);
    byDate.set(localDate, arr);
  }

  return NextResponse.json({
    eventId: params.id,
    days: Array.from(byDate.entries()).map(([d, slots]) => ({
      date: d,
      slots: slots.map((s) => ({
        id: s.id,
        start: s.slot_start,
        end: s.slot_end,
        remaining: s.remaining,
        capacity: s.capacity,
      })),
    })),
  });
}
